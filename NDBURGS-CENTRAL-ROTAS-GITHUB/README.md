# ND BURGS — Central de Rotas

Repositório oficial de código-fonte e backup da Central de Rotas da ND BURGS.

## IMPORTANTE: arquitetura atual

O sistema usa `google.script.run` para login, pedidos, GPS, atualização de entregas e rastreamento. Por isso, **as telas operacionais precisam continuar sendo servidas pelo Google Apps Script**. Publicar os arquivos operacionais diretamente no GitHub Pages, sem migrar essa comunicação, faria essas funções pararem de funcionar.

Este repositório organiza e versiona os arquivos. O GitHub Pages incluído em `/docs` pode servir como página inicial/atalho, mas não substitui o Apps Script nesta etapa.

## Arquivos

- `apps-script/Code.gs` — backend otimizado do Apps Script.
- `apps-script/index.html` — painel principal.
- `apps-script/maps.html` — página de acompanhamento do cliente, com status atual piscando em vermelho e etapas concluídas em verde.
- `docs/index.html` — página inicial simples para GitHub Pages.

## Como colocar no GitHub

1. Entre em https://github.com e crie um repositório chamado `ndburgs-central-rotas`.
2. Deixe o repositório **Private** se não quiser expor o código e configurações internas.
3. Clique em **Add file → Upload files**.
4. Envie todos os arquivos e pastas deste pacote, mantendo a estrutura (`apps-script` e `docs`).
5. Clique em **Commit changes**.

## GitHub Pages (opcional)

A pasta `/docs` contém apenas uma página inicial/atalho; ela **não hospeda o painel operacional**. Não ative o Pages nem torne o repositório público por enquanto. O código atual contém configurações de acesso e deve ficar em repositório **Private**. Depois de revisar e proteger credenciais, podemos decidir se vale publicar uma página pública separada.

Se futuramente for habilitar o Pages, edite `docs/index.html` e substitua `COLE_AQUI_A_URL_DO_APP_SCRIPT` pelo endereço publicado do Web App. A disponibilidade do Pages para repositórios privados depende do plano do GitHub.

## Atualizar o Apps Script

O GitHub não atualiza automaticamente o projeto Apps Script. Para publicar uma atualização:

1. Abra o projeto no Apps Script.
2. Copie o conteúdo de `apps-script/Code.gs` para o arquivo `Code.gs`.
3. Copie `apps-script/index.html` para o arquivo HTML principal usado pelo `doGet`.
4. Atualize a página de acompanhamento com `apps-script/maps.html` conforme a rota/link que seu projeto já utiliza.
5. Salve, teste e só então publique uma nova versão do Web App.

**Não apague o projeto Apps Script nem altere as permissões da implantação atual durante esta etapa.** Faça backup antes de substituir arquivos.

## Segurança

- Não coloque PINs, tokens, chaves privadas ou credenciais em páginas públicas.
- Se o repositório for público, revise o código antes de enviar.
- O GitHub Pages é público mesmo quando o projeto tem informações que você não deseja divulgar; mantenha o repositório privado quando necessário.
