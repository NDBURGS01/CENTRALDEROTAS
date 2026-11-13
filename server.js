const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'TROQUE-ESTA-CHAVE-ANTES-DE-PUBLICAR-' + crypto.randomBytes(24).toString('hex');
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'ndburgs.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'operator', active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Hambúrguer',
 description TEXT DEFAULT '', price REAL NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0,
 stock REAL NOT NULL DEFAULT 0, min_stock REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, customer_id INTEGER,
 customer_name TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT DEFAULT '',
 channel TEXT NOT NULL DEFAULT 'Balcão', status TEXT NOT NULL DEFAULT 'novo',
 payment_method TEXT DEFAULT 'Não informado', subtotal REAL NOT NULL DEFAULT 0,
 discount REAL NOT NULL DEFAULT 0, delivery_fee REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
 notes TEXT DEFAULT '', driver_name TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(customer_id) REFERENCES customers(id)
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER,
 product_name TEXT NOT NULL, quantity REAL NOT NULL, unit_price REAL NOT NULL, total REAL NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS inventory_movements (
 id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, type TEXT NOT NULL,
 quantity REAL NOT NULL, reason TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS expenses (
 id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, category TEXT DEFAULT 'Geral',
 amount REAL NOT NULL, due_date TEXT DEFAULT '', paid INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const count = db.prepare('SELECT COUNT(*) n FROM users').get().n;
if (!count) {
 const hash = bcrypt.hashSync('ndburgs123', 10);
 db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
   .run('Administrador ND BURGS','admin@ndburgs.com',hash,'admin');
}
if (!db.prepare('SELECT COUNT(*) n FROM products').get().n) {
 const ins = db.prepare('INSERT INTO products (name,category,description,price,cost,stock,min_stock) VALUES (?,?,?,?,?,?,?)');
 const seed = [
  ['X-Burger','Hambúrguer','Pão, carne e queijo',24,9,40,8],
  ['X-Salada','Hambúrguer','Carne, queijo, alface e tomate',27,11,35,8],
  ['X-Egg','Hambúrguer','Carne, queijo e ovo',29,12,30,8],
  ['X-Bacon','Hambúrguer','Carne, queijo e bacon',32,14,25,6],
  ['Batata P','Acompanhamento','Porção pequena',12,4,40,8],
  ['Refrigerante Lata','Bebida','Lata 350 ml',6,2.5,60,12]
 ];
 seed.forEach(p=>ins.run(...p));
}

function auth(req,res,next) {
 const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if(!token) return res.status(401).json({error:'Faça login para continuar.'});
 try { req.user=jwt.verify(token,JWT_SECRET); next(); }
 catch { return res.status(401).json({error:'Sessão expirada. Entre novamente.'}); }
}
function admin(req,res,next){ if(req.user.role!=='admin') return res.status(403).json({error:'Acesso restrito ao administrador.'}); next(); }
function num(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
function today(){ return new Date().toISOString().slice(0,10); }

app.post('/api/login',(req,res)=>{
 const {email,password}=req.body||{};
 const user=db.prepare('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1').get(String(email||'').trim());
 if(!user || !bcrypt.compareSync(String(password||''),user.password_hash)) return res.status(401).json({error:'E-mail ou senha inválidos.'});
 const token=jwt.sign({id:user.id,name:user.name,email:user.email,role:user.role},JWT_SECRET,{expiresIn:'12h'});
 res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role}});
});
app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/dashboard',auth,(req,res)=>{
 const sales=db.prepare("SELECT COALESCE(SUM(total),0) total,COUNT(*) orders FROM orders WHERE date(created_at)=date('now','localtime') AND status!='cancelado'").get();
 const open=db.prepare("SELECT COUNT(*) n FROM orders WHERE status NOT IN ('entregue','cancelado')").get().n;
 const low=db.prepare('SELECT COUNT(*) n FROM products WHERE active=1 AND stock<=min_stock').get().n;
 const recent=db.prepare('SELECT id,code,customer_name,channel,status,total,created_at FROM orders ORDER BY id DESC LIMIT 8').all();
 const daily=db.prepare("SELECT strftime('%H:00',created_at,'localtime') hour,COALESCE(SUM(total),0) total FROM orders WHERE date(created_at)=date('now','localtime') AND status!='cancelado' GROUP BY strftime('%H',created_at,'localtime') ORDER BY hour").all();
 res.json({sales,open,low,recent,daily});
});
app.get('/api/products',auth,(req,res)=>res.json(db.prepare('SELECT * FROM products ORDER BY category,name').all()));
app.post('/api/products',auth,admin,(req,res)=>{
 const p=req.body||{}; if(!String(p.name||'').trim()) return res.status(400).json({error:'Informe o nome do produto.'});
 const info=db.prepare('INSERT INTO products(name,category,description,price,cost,stock,min_stock) VALUES(?,?,?,?,?,?,?)')
 .run(p.name.trim(),p.category||'Geral',p.description||'',Math.max(0,num(p.price)),Math.max(0,num(p.cost)),Math.max(0,num(p.stock)),Math.max(0,num(p.min_stock)));
 res.json({id:info.lastInsertRowid});
});
app.put('/api/products/:id',auth,admin,(req,res)=>{
 const p=req.body||{}; db.prepare('UPDATE products SET name=?,category=?,description=?,price=?,cost=?,stock=?,min_stock=?,active=? WHERE id=?')
 .run(p.name,p.category||'Geral',p.description||'',Math.max(0,num(p.price)),Math.max(0,num(p.cost)),Math.max(0,num(p.stock)),Math.max(0,num(p.min_stock)),p.active===false?0:1,req.params.id);
 res.json({ok:true});
});
app.get('/api/orders',auth,(req,res)=>{
 const orders=db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 250').all();
 const items=db.prepare('SELECT * FROM order_items WHERE order_id=?');
 res.json(orders.map(o=>({...o,items:items.all(o.id)})));
});
app.post('/api/orders',auth,(req,res)=>{
 const p=req.body||{}, items=Array.isArray(p.items)?p.items:[];
 if(!items.length) return res.status(400).json({error:'Adicione pelo menos um item ao pedido.'});
 const normalized=items.map(i=>{const prod=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(i.product_id); if(!prod) throw new Error('Um produto do pedido não foi encontrado.'); const q=Math.max(0.01,num(i.quantity)); return {product:prod,q,price:Math.max(0,num(i.unit_price??prod.price))};});
 const subtotal=normalized.reduce((s,i)=>s+i.q*i.price,0), discount=Math.max(0,num(p.discount)),fee=Math.max(0,num(p.delivery_fee)),total=Math.max(0,subtotal-discount+fee);
 const code='ND-'+Date.now().toString().slice(-8);
 const create=db.transaction(()=>{
  const info=db.prepare(`INSERT INTO orders(code,customer_name,phone,address,channel,status,payment_method,subtotal,discount,delivery_fee,total,notes,driver_name)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code,String(p.customer_name||'Cliente balcão'),p.phone||'',p.address||'',p.channel||'Balcão','novo',p.payment_method||'Não informado',subtotal,discount,fee,total,p.notes||'',p.driver_name||'');
  const add=db.prepare('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,total) VALUES(?,?,?,?,?,?)');
  normalized.forEach(i=>add.run(info.lastInsertRowid,i.product.id,i.product.name,i.q,i.price,i.q*i.price));
  return info.lastInsertRowid;
 });
 try { const id=create(); res.json({id,code,total}); } catch(e){res.status(400).json({error:e.message});}
});
app.patch('/api/orders/:id/status',auth,(req,res)=>{
 const allowed=['novo','preparando','pronto','saiu_entrega','entregue','cancelado'];
 if(!allowed.includes(req.body.status)) return res.status(400).json({error:'Status inválido.'});
 db.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status,req.params.id);
 res.json({ok:true});
});
app.patch('/api/orders/:id/driver',auth,(req,res)=>{
 db.prepare('UPDATE orders SET driver_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.driver_name||'',req.params.id); res.json({ok:true});
});
app.get('/api/kitchen',auth,(req,res)=>res.json(db.prepare("SELECT o.*,GROUP_CONCAT(oi.quantity||'x '||oi.product_name,' • ') items FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.status IN ('novo','preparando') GROUP BY o.id ORDER BY o.created_at").all()));
app.get('/api/inventory/movements',auth,(req,res)=>res.json(db.prepare('SELECT m.*,p.name product_name FROM inventory_movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 100').all()));
app.post('/api/inventory/movements',auth,admin,(req,res)=>{
 const {product_id,type,quantity,reason}=req.body||{}, q=Math.abs(num(quantity));
 if(!product_id||!q||!['entrada','saida','ajuste'].includes(type)) return res.status(400).json({error:'Confira produto, tipo e quantidade.'});
 const tx=db.transaction(()=>{
  const p=db.prepare('SELECT * FROM products WHERE id=?').get(product_id); if(!p) throw new Error('Produto não encontrado.');
  const next=type==='entrada'?p.stock+q:type==='saida'?p.stock-q:q;
  if(next<0) throw new Error('Estoque insuficiente.');
  db.prepare('UPDATE products SET stock=? WHERE id=?').run(next,product_id);
  db.prepare('INSERT INTO inventory_movements(product_id,type,quantity,reason) VALUES(?,?,?,?)').run(product_id,type,q,reason||'');
 }); try{tx();res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}
});
app.get('/api/expenses',auth,(req,res)=>res.json(db.prepare('SELECT * FROM expenses ORDER BY id DESC LIMIT 200').all()));
app.post('/api/expenses',auth,admin,(req,res)=>{
 const p=req.body||{}; if(!p.description||num(p.amount)<=0) return res.status(400).json({error:'Informe descrição e valor válido.'});
 const info=db.prepare('INSERT INTO expenses(description,category,amount,due_date,paid) VALUES(?,?,?,?,?)').run(p.description,p.category||'Geral',num(p.amount),p.due_date||'',p.paid?1:0);
 res.json({id:info.lastInsertRowid});
});
app.patch('/api/expenses/:id/paid',auth,admin,(req,res)=>{db.prepare('UPDATE expenses SET paid=? WHERE id=?').run(req.body.paid?1:0,req.params.id);res.json({ok:true});});
app.get('/api/reports',auth,(req,res)=>{
 const from=req.query.from||today().slice(0,7)+'-01',to=req.query.to||today();
 const sales=db.prepare("SELECT COUNT(*) orders,COALESCE(SUM(total),0) revenue,COALESCE(AVG(total),0) average FROM orders WHERE date(created_at) BETWEEN ? AND ? AND status NOT IN ('cancelado')").get(from,to);
 const expenses=db.prepare('SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE paid=1 AND date(created_at) BETWEEN ? AND ?').get(from,to).total;
 const methods=db.prepare("SELECT payment_method method,COUNT(*) count,COALESCE(SUM(total),0) total FROM orders WHERE date(created_at) BETWEEN ? AND ? AND status!='cancelado' GROUP BY payment_method").all(from,to);
 res.json({from,to,sales,expenses,estimated_result:sales.revenue-expenses,methods});
});
app.get('/api/users',auth,admin,(req,res)=>res.json(db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY id').all()));
app.post('/api/users',auth,admin,(req,res)=>{
 const p=req.body||{}; if(!p.name||!p.email||String(p.password||'').length<8) return res.status(400).json({error:'Nome, e-mail e senha com pelo menos 8 caracteres são obrigatórios.'});
 try{const info=db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(p.name,p.email,bcrypt.hashSync(p.password,10),p.role==='admin'?'admin':'operator');res.json({id:info.lastInsertRowid});}catch(e){res.status(400).json({error:'E-mail já cadastrado.'});}
});
app.get('/api/health',(req,res)=>res.json({ok:true,app:'ND BURGS',time:new Date().toISOString()}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`ND BURGS disponível em http://localhost:${PORT}`));
