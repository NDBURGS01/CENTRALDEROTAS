# ND BURGS — Sistema web de gestão

Primeira base funcional de uma plataforma própria para hamburgueria. Interface dark responsiva, API Node.js/Express e banco SQLite local.

## Módulos incluídos
- Login e perfis de administrador/operador
- Visão geral com indicadores e pedidos recentes
- Frente de caixa com carrinho, canal, cliente, pagamento, desconto e taxa de entrega
- Pedidos e atualização de status
- Painel de cozinha
- Gestão básica de delivery e atribuição de entregador
- Cadastro de produtos
- Estoque e movimentações
- Despesas e visão financeira
- Relatório resumido por mês
- Cadastro de usuários

## Executar localmente
Requer Node.js 20 ou superior.

1. Extraia o ZIP.
2. Abra um terminal na pasta do projeto.
3. Execute `npm install`.
4. Configure `JWT_SECRET` usando `.env.example` como referência (ou variável de ambiente do provedor).
5. Execute `npm start`.
6. Acesse `http://localhost:3000`.

Primeiro acesso criado automaticamente:
- E-mail: `admin@ndburgs.com`
- Senha: `ndburgs123`

**Troque a senha inicial e configure uma chave JWT forte antes de colocar o sistema na internet.** Não use credenciais de demonstração em produção.

## Banco de dados
O arquivo `data/ndburgs.sqlite` é criado automaticamente na primeira execução. Faça backup regular dessa pasta. O SQLite é adequado para iniciar e testar em uma instância única; para múltiplas instâncias/escala, migre para PostgreSQL.

## Antes de operar de verdade
Esta é uma primeira versão funcional, não um PDV fiscal certificado. Ainda precisam ser implementados/testados conforme a operação real: integração com impressoras, emissão fiscal, integração de pagamentos, WhatsApp, ficha técnica com baixa automática de ingredientes, contas recorrentes, permissões granulares, trilha de auditoria, backup automatizado e testes de carga/segurança. O módulo de motoboys ainda é uma gestão básica de atribuição/status, não um aplicativo GPS em tempo real.

## Segurança e implantação
- Hospede em serviço que mantenha processo Node e disco persistente (por exemplo, VPS ou plataforma com volume persistente).
- Configure HTTPS, `JWT_SECRET` forte, backup e política de acesso.
- O SQLite não deve ficar em diretório público.
- Não exponha o banco ou credenciais.
