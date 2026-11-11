const APP_TITLE = 'ND BURGS - Central de Rotas';
// IMPORTANTE: ao instalar, mantenha aqui os mesmos PINs reais que já funcionam no seu projeto atual.
const INITIAL_ACCESS = {
  ADMIN: '2912',
  DANILO: '1234',
  THIAGO: '4321',
  ANSELMO: '4243'
};
const ORDER_HEADERS = ['id','no','cliente','address','street','region','boy','notes','created','outAt','status','routeIndex','deliveredAt','trackingToken','source','locator','payment','total','changeFor'];
const DELIVERY_HISTORY_HEADERS = ['orderId','pedido','cliente','motoboy','endereco','regiao','pagamento','total','trocoPara','criadoEm','saiuEm','entregueEm'];
const SESSION_TTL = 21600;

// Gera um identificador único e imprevisível para o link de acompanhamento do pedido.
function createTrackingToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const mapKey = String(params.mapa || '').trim();
  const trackingToken = String(params.pedido || '').trim();
  if (mapKey || trackingToken) {
    const page = HtmlService.createTemplateFromFile('LocationMap');
    page.mapKey = mapKey;
    page.trackingToken = trackingToken;
    page.driverName = '';
    return page.evaluate().setTitle(trackingToken ? 'ND BURGS | Acompanhe seu pedido' : 'ND BURGS | Localização dos motoboys')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  const page = HtmlService.createTemplateFromFile('Index');
  page.appUrl = ScriptApp.getService().getUrl();
  return page.evaluate().setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Execute esta função uma vez no editor para criar a planilha e autorizar o acesso.
function setupND() {
  const ss = ensureDatabase_();
  return 'Banco criado: ' + ss.getUrl();
}

// LOCALIZAÇÃO COMPARTILHADA DOS MOTOBOYS — sem Supabase.
function apiStartMyLocation(token) {
  const session = requireSession_(token);
  if (session.role !== 'driver') throw new Error('Somente o motoboy pode iniciar o compartilhamento.');
  const sheet = ensureLocationSheet_();
  const row = findLocationRow_(sheet, session.name);
  const old = row ? sheet.getRange(row, 1, 1, 8).getValues()[0] : [];
  const values = [session.name, '', '', '', '', '', Date.now(), true];
  if (row) sheet.getRange(row, 1, 1, 8).setValues([values]); else sheet.appendRow(values);
  return { ok: true, name: session.name };
}

function apiUpdateMyLocation(token, point) {
  const session = requireSession_(token);
  if (session.role !== 'driver') throw new Error('Somente o motoboy pode atualizar a localização.');
  const lat = Number(point && point.lat), lng = Number(point && point.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Coordenadas inválidas.');
  const sheet = ensureLocationSheet_();
  const row = findLocationRow_(sheet, session.name);
  const values = [session.name, lat, lng, Number(point.accuracy) || '', Number(point.heading) || '', Number(point.speed) || '', Date.now(), true];
  if (row) sheet.getRange(row, 1, 1, 8).setValues([values]); else sheet.appendRow(values);
  return { ok: true, updatedAt: values[6] };
}

function apiStopMyLocation(token) {
  const session = requireSession_(token);
  if (session.role !== 'driver') throw new Error('Somente o motoboy pode parar o compartilhamento.');
  const sheet = ensureLocationSheet_();
  const row = findLocationRow_(sheet, session.name);
  if (row) { sheet.getRange(row, 7).setValue(Date.now()); sheet.getRange(row, 8).setValue(false); }
  return { ok: true };
}

function apiAdminLocationData(token) {
  const session = requireSession_(token);
  if (session.role !== 'admin') throw new Error('Apenas a loja pode consultar o painel de localização.');
  return { ok: true, locations: readLocations_(), url: getLocationShareUrl_() };
}

// Link único para compartilhar com os clientes. Quem tiver o link poderá ver todos os motoboys ativos.
function apiPublicLocations(mapKey) {
  const expected = PropertiesService.getScriptProperties().getProperty('ND_PUBLIC_MAP_KEY') || '';
  if (!expected || String(mapKey || '') !== expected) return { ok: false, locations: [] };
  const cutoff = Date.now() - 45000;
  const locations = readLocations_().filter(x => x.active && x.updatedAt >= cutoff && x.lat !== null && x.lng !== null && Number.isFinite(x.lat) && Number.isFinite(x.lng));
  return { ok: true, locations: locations };
}

// Consulta pública de um pedido por token aleatório. Não expõe telefone, pagamento ou endereço completo.
function apiPublicOrderTracking(trackingToken) {
  const token = String(trackingToken || '').trim();
  if (!token || token.length < 32) return { ok: false, message: 'Link de acompanhamento inválido.' };
  const ss = ensureDatabase_();
  const orders = readOrders_(ss.getSheetByName('PEDIDOS'));
  const order = orders.find(o => o.trackingToken && o.trackingToken === token);
  if (!order) return { ok: false, message: 'Pedido não encontrado ou link inválido.' };
  let location = null;
  if (['entrega', 'chegou'].includes(order.status) && order.boy) {
    const cutoff = Date.now() - 45000;
    location = readLocations_().find(x => x.name === order.boy && x.active && x.updatedAt >= cutoff &&
      Number.isFinite(x.lat) && Number.isFinite(x.lng)) || null;
  }
  return {
    ok: true,
    order: { no: order.no || '', status: order.status, boy: order.boy || '', created: order.created || 0 },
    location: location
  };
}

function ensureLocationSheet_() {
  const ss = ensureDatabase_();
  let sh = ss.getSheetByName('LOCALIZACAO');
  if (!sh) sh = ss.insertSheet('LOCALIZACAO');
  if (sh.getLastRow() === 0) sh.appendRow(['motoboy','latitude','longitude','precisao','direcao','velocidade','atualizadoEm','ativo']);
  return sh;
}

function findLocationRow_(sheet, name) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const names = sheet.getRange(2, 1, last - 1, 1).getValues();
  const i = names.findIndex(r => String(r[0]) === name);
  return i < 0 ? 0 : i + 2;
}

function readLocations_() {
  const sh = ensureLocationSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 8).getValues().filter(r => r[0]).map(r => ({
    name: String(r[0]), lat: r[1] === '' ? null : Number(r[1]), lng: r[2] === '' ? null : Number(r[2]), accuracy: Number(r[3]) || null,
    heading: Number(r[4]) || null, speed: Number(r[5]) || null, updatedAt: Number(r[6]) || 0,
    active: r[7] === true || String(r[7]).toLowerCase() === 'true'
  }));
}

function getLocationShareUrl_() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('ND_PUBLIC_MAP_KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty('ND_PUBLIC_MAP_KEY', key); }
  return ScriptApp.getService().getUrl() + '?mapa=' + encodeURIComponent(key);
}

function apiLogin(pin) {
  const cleanPin = String(pin || '').trim();
  const role = Object.keys(INITIAL_ACCESS).find(k => INITIAL_ACCESS[k] && !INITIAL_ACCESS[k].startsWith('TROQUE-') && INITIAL_ACCESS[k] === cleanPin);
  if (!role) return { ok: false };
  ensureDatabase_();
  const token = Utilities.getUuid() + Utilities.getUuid();
  const session = { role: role === 'ADMIN' ? 'admin' : 'driver', name: role === 'ADMIN' ? 'LOJA' : role };
  CacheService.getScriptCache().put('session_' + token, JSON.stringify(session), SESSION_TTL);
  return { ok: true, token: token, role: session.role, name: session.name, state: stateFor_(session) };
}

function apiResume(token) {
  const session = getSession_(token);
  if (!session) return { ok: false };
  return { ok: true, token: token, role: session.role, name: session.name, state: stateFor_(session) };
}

function apiGetState(token) {
  const session = requireSession_(token);
  return { ok: true, state: stateFor_(session) };
}

function apiSaveAdminState(token, incoming) {
  const session = requireSession_(token);
  if (session.role !== 'admin') throw new Error('Apenas a loja pode alterar o cadastro e a distribuição dos pedidos.');
  if (!incoming || !Array.isArray(incoming.orders)) throw new Error('Dados de pedidos inválidos.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = ensureDatabase_();
    const sheet = ss.getSheetByName('PEDIDOS');
    const current = readOrders_(sheet);
    const currentById = Object.fromEntries(current.map(o => [String(o.id), o]));
    const merged = incoming.orders.map(o => {
      const old = currentById[String(o.id)];
      if (!old) return sanitizeOrder_({ ...o, trackingToken: o.trackingToken || createTrackingToken_() });
      const keepToken = o.trackingToken || old.trackingToken || createTrackingToken_();
      const rank = { aguardando: 0, entrega: 1, chegou: 2, entregue: 3 };
      if ((rank[old.status] || 0) > (rank[o.status] || 0)) {
        return sanitizeOrder_({ ...o, trackingToken: keepToken, status: old.status, outAt: old.outAt, deliveredAt: old.deliveredAt });
      }
      return sanitizeOrder_({ ...o, trackingToken: keepToken });
    });
    merged.forEach(o => {
      const old = currentById[String(o.id)];
      if (o.status === 'entregue' && o.deliveredAt && (!old || old.status !== 'entregue')) recordDeliveryHistory_(ss, o);
    });
    writeOrders_(sheet, merged);
    writeConfig_(ss, {
      streetRegions: incoming.streetRegions || {},
      near: Array.isArray(incoming.near) ? incoming.near : [],
      draft: Array.isArray(incoming.draft) ? incoming.draft : [],
      draftBoy: incoming.draftBoy || 'DANILO'
    });
  } finally {
    lock.releaseLock();
  }
  // A leitura completa do painel acontece depois de liberar o bloqueio de gravação.
  return { ok: true, state: stateFor_(session) };
}

function apiDriverUpdate(token, orderId, action) {
  const session = requireSession_(token);
  if (session.role !== 'driver') throw new Error('Esta ação é exclusiva do acesso do motoboy.');

  // Prepara/acessa o banco antes do bloqueio para reduzir o tempo de disputa entre usuários.
  const ss = ensureDatabase_();
  const lock = LockService.getScriptLock();
  // Não deixa o motoboy preso por até 15 segundos se outra gravação estiver em andamento.
  if (!lock.tryLock(8000)) {
    throw new Error('A central está salvando outros dados. Aguarde alguns segundos e tente novamente.');
  }

  let updatedOrder = null;
  try {
    const sheet = ss.getSheetByName('PEDIDOS');
    const last = sheet.getLastRow();
    if (last < 2) throw new Error('Pedido não encontrado.');

    const rows = sheet.getRange(2, 1, last - 1, ORDER_HEADERS.length).getValues();
    const index = rows.findIndex(r => String(r[0]) === String(orderId));
    if (index < 0) throw new Error('Pedido não encontrado.');

    const rowNumber = index + 2;
    const row = rows[index];
    if (String(row[6] || '') !== session.name) throw new Error('Este pedido não está atribuído a você.');

    const now = Date.now();
    if (action === 'start') {
      if (row[10] !== 'aguardando') throw new Error('Este pedido já saiu ou foi entregue.');
      row[9] = now;
      row[10] = 'entrega';
    } else if (action === 'arrive') {
      if (row[10] !== 'entrega') throw new Error('O pedido precisa estar a caminho antes de registrar a chegada.');
      row[10] = 'chegou';
    } else if (action === 'done') {
      if (row[10] !== 'chegou') throw new Error('Registre a chegada ao cliente antes de concluir o pedido.');
      row[10] = 'entregue';
      row[12] = now;
    } else {
      throw new Error('Ação inválida.');
    }

    // Uma única gravação na linha do pedido; não reescreve a planilha inteira.
    sheet.getRange(rowNumber, 1, 1, ORDER_HEADERS.length).setValues([row]);
    updatedOrder = orderFromRow_(row);

    if (action === 'done') {
      recordDeliveryHistory_(ss, updatedOrder);
    }
  } finally {
    lock.releaseLock();
  }

  // Retorna somente o pedido alterado. A leitura completa do painel fica fora do bloqueio.
  return {
    ok: true,
    order: updatedOrder,
    delivery: action === 'done' ? {
      id: updatedOrder.id, no: updatedOrder.no, cliente: updatedOrder.cliente,
      boy: updatedOrder.boy, address: updatedOrder.address, region: updatedOrder.region,
      payment: updatedOrder.payment, total: updatedOrder.total, changeFor: updatedOrder.changeFor,
      created: updatedOrder.created, outAt: updatedOrder.outAt,
      deliveredAt: updatedOrder.deliveredAt, status: 'entregue'
    } : null
  };
}

function getSession_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('session_' + String(token));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function requireSession_(token) {
  const session = getSession_(token);
  if (!session) throw new Error('Sua sessão expirou. Entre novamente com seu PIN.');
  return session;
}

function stateFor_(session) {
  const ss = ensureDatabase_();
  const sheet = ss.getSheetByName('PEDIDOS');
  const orders = readOrders_(sheet);
  const cfg = readConfig_(ss);
  const visibleOrders = session.role === 'admin' ? orders : orders.filter(o => o.boy === session.name);
  return {
    orders: visibleOrders,
    deliveries: readDeliveryHistory_(ss).filter(o => session.role === 'admin' || o.boy === session.name),
    streetRegions: session.role === 'admin' ? (cfg.streetRegions || {}) : {},
    near: session.role === 'admin' ? (cfg.near || []) : [],
    draft: session.role === 'admin' ? (cfg.draft || []) : [],
    draftBoy: cfg.draftBoy || 'DANILO'
  };
}

function ensureDatabase_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('ND_ROUTE_SPREADSHEET_ID');
  let ss;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(APP_TITLE + ' - Dados compartilhados');
    props.setProperty('ND_ROUTE_SPREADSHEET_ID', ss.getId());
  }
  let orders = ss.getSheetByName('PEDIDOS');
  if (!orders) {
    const first = ss.getSheets()[0];
    if (first && first.getName() === 'Sheet1') first.setName('PEDIDOS');
    orders = ss.getSheetByName('PEDIDOS') || ss.insertSheet('PEDIDOS');
  }
  if (orders.getLastRow() === 0) {
    orders.appendRow(ORDER_HEADERS);
  } else {
    // Migração compatível: mantém as 14 colunas antigas e acrescenta origem/localizador ao final.
    const currentHeaders = orders.getRange(1, 1, 1, ORDER_HEADERS.length).getValues()[0];
    ORDER_HEADERS.forEach((header, index) => {
      if (String(currentHeaders[index] || '') !== header) {
        orders.getRange(1, index + 1).setValue(header);
      }
    });
  }
  let locations = ss.getSheetByName('LOCALIZACAO');
  if (!locations) locations = ss.insertSheet('LOCALIZACAO');
  if (locations.getLastRow() === 0) locations.appendRow(['motoboy','latitude','longitude','precisao','direcao','velocidade','atualizadoEm','ativo']);
  let config = ss.getSheetByName('CONFIG');
  if (!config) config = ss.insertSheet('CONFIG');
  if (config.getLastRow() === 0) config.appendRow(['chave','valor']);
  ensureDeliveryHistorySheet_(ss);

  // Migrações pesadas são executadas uma única vez, não em toda chamada do aplicativo.
  // Novos pedidos já recebem token no salvamento e novas entregas entram no histórico
  // diretamente em apiDriverUpdate/apiSaveAdminState.
  if (props.getProperty('ND_ROUTE_TOKENS_MIGRATED_V1') !== '1') {
    ensureTrackingTokens_(orders);
    props.setProperty('ND_ROUTE_TOKENS_MIGRATED_V1', '1');
  }
  if (props.getProperty('ND_ROUTE_HISTORY_MIGRATED_V1') !== '1') {
    readOrders_(orders)
      .filter(o => o.status === 'entregue' && o.deliveredAt)
      .forEach(o => recordDeliveryHistory_(ss, o));
    props.setProperty('ND_ROUTE_HISTORY_MIGRATED_V1', '1');
  }
  return ss;
}

// Gera links individuais também para pedidos antigos, sem alterar os demais dados.
function ensureTrackingTokens_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return;
  const range = sheet.getRange(2, 14, last - 1, 1);
  const values = range.getValues();
  let changed = false;
  values.forEach(row => {
    if (!String(row[0] || '').trim()) {
      row[0] = createTrackingToken_();
      changed = true;
    }
  });
  if (changed) range.setValues(values);
}

function ensureDeliveryHistorySheet_(ss) {
  let sh = ss.getSheetByName('HISTORICO_ENTREGAS');
  if (!sh) sh = ss.insertSheet('HISTORICO_ENTREGAS');
  if (sh.getLastRow() === 0) sh.appendRow(DELIVERY_HISTORY_HEADERS);
  else DELIVERY_HISTORY_HEADERS.forEach((h,i) => { if (String(sh.getRange(1,i+1).getValue() || '') !== h) sh.getRange(1,i+1).setValue(h); });
  return sh;
}

function recordDeliveryHistory_(ss, o) {
  if (!o || !o.id || !o.deliveredAt) return;
  const sh = ensureDeliveryHistorySheet_(ss);
  const last = sh.getLastRow();
  if (last >= 2) {
    const ids = sh.getRange(2,1,last-1,1).getValues().flat().map(String);
    if (ids.includes(String(o.id))) return;
  }
  sh.appendRow([String(o.id),String(o.no||''),String(o.cliente||''),String(o.boy||''),String(o.address||''),String(o.region||''),String(o.payment||''),Number(o.total)||0,Number(o.changeFor)||0,Number(o.created)||0,Number(o.outAt)||0,Number(o.deliveredAt)||Date.now()]);
}

function readDeliveryHistory_(ss) {
  const sh = ensureDeliveryHistorySheet_(ss), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2,1,last-1,DELIVERY_HISTORY_HEADERS.length).getValues().filter(r => r[0]).map(r => ({id:String(r[0]),no:String(r[1]||''),cliente:String(r[2]||''),boy:String(r[3]||''),address:String(r[4]||''),region:String(r[5]||''),payment:String(r[6]||''),total:Number(r[7])||0,changeFor:Number(r[8])||0,created:Number(r[9])||0,outAt:Number(r[10])||0,deliveredAt:Number(r[11])||0,status:'entregue'}));
}

function orderFromRow_(r) {
  return {
    id: String(r[0]), no: String(r[1] || ''), cliente: String(r[2] || ''), address: String(r[3] || ''),
    street: String(r[4] || ''), region: String(r[5] || ''), boy: String(r[6] || ''), notes: String(r[7] || ''),
    created: Number(r[8]) || 0, outAt: r[9] === '' ? null : Number(r[9]), status: String(r[10] || 'aguardando'),
    routeIndex: r[11] === '' ? null : Number(r[11]), deliveredAt: r[12] === '' ? null : Number(r[12]),
    trackingToken: String(r[13] || ''), source: String(r[14] || ''), locator: String(r[15] || ''),
    payment: String(r[16] || ''), total: Number(r[17]) || 0, changeFor: Number(r[18]) || 0
  };
}

function readOrders_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, ORDER_HEADERS.length).getValues()
    .filter(r => r[0] !== '').map(orderFromRow_);
}

function writeOrders_(sheet, orders) {
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, ORDER_HEADERS.length).clearContent();
  if (!orders.length) return;
  const values = orders.map(o => [o.id,o.no,o.cliente,o.address,o.street,o.region,o.boy,o.notes,o.created,o.outAt || '',o.status,o.routeIndex || '',o.deliveredAt || '',o.trackingToken || '',o.source || '',o.locator || '',o.payment || '',o.total || '',o.changeFor || '']);
  sheet.getRange(2, 1, values.length, ORDER_HEADERS.length).setValues(values);
}

function sanitizeOrder_(o) {
  const allowed = ['DANILO','THIAGO','ANSELMO',''];
  return {
    id: String(o.id || Utilities.getUuid()), no: String(o.no || '').slice(0,80), cliente: String(o.cliente || '').slice(0,160),
    address: String(o.address || '').slice(0,500), street: String(o.street || '').slice(0,180), region: String(o.region || '').slice(0,100),
    boy: allowed.includes(String(o.boy || '')) ? String(o.boy || '') : '', notes: String(o.notes || '').slice(0,500),
    created: Number(o.created) || Date.now(), outAt: Number(o.outAt) || null,
    status: ['aguardando','entrega','chegou','entregue'].includes(o.status) ? o.status : 'aguardando',
    routeIndex: Number(o.routeIndex) || null, deliveredAt: Number(o.deliveredAt) || null,
    trackingToken: String(o.trackingToken || ''),
    source: ['WHATSAPP','99','IFOOD'].includes(String(o.source || '')) ? String(o.source) : '',
    locator: String(o.locator || '').slice(0,160),
    payment: ['PIX','DINHEIRO','CARTÃO','IFOOD','99FOOD'].includes(String(o.payment || '').toUpperCase()) ? String(o.payment || '').toUpperCase() : '',
    total: Math.max(0, Number(o.total) || 0),
    changeFor: Math.max(0, Number(o.changeFor) || 0)
  };
}

function readConfig_(ss) {
  const sheet = ss.getSheetByName('CONFIG');
  const last = sheet.getLastRow();
  const map = {};
  if (last >= 2) sheet.getRange(2,1,last-1,2).getValues().forEach(r => { try { map[r[0]] = JSON.parse(r[1]); } catch (e) {} });
  return map;
}

function writeConfig_(ss, config) {
  const sheet = ss.getSheetByName('CONFIG');
  const values = Object.keys(config).map(k => [k, JSON.stringify(config[k])]);
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2,1,last-1,2).clearContent();
  if (values.length) sheet.getRange(2,1,values.length,2).setValues(values);
}
