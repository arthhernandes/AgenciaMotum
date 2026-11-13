# Preparação antes do deploy

Produção planejada: `https://escola.agenciamotum.com.br`.

Repositório: `https://github.com/arthhernandes/AgenciaMotum`.

## Arquivo privado de configuração

```powershell
npm.cmd run prepare:production
```

Cria `apps/backend/.env` a partir de `deploy/server.env.example`, gerando `JWT_SECRET` e uma senha inicial master. Se o arquivo já existir, não altera nenhuma linha. A senha não é impressa no terminal; consulte o arquivo local para entrar após a criação do administrador. O arquivo é ignorado pelo Git.

Preencha:

1. `DATABASE_URL`: Transaction pooler Supabase, porta 6543.
2. `DIRECT_URL`: Session pooler, porta 5432, ou conexão direta compatível com sua rede.
3. Senha PostgreSQL nas duas URLs, com caracteres especiais percent-encoded. É a senha do banco, não a senha da conta Supabase ou uma API key.
4. `MASTER_ADMIN_EMAIL`: o e-mail usado para entrar no sistema.
5. Credenciais dos aplicativos Bling e Mercado Livre. Se o assistente for usado, configure um provedor de IA remoto.

Use estas URLs de retorno no cadastro dos aplicativos e no `.env`:

```text
https://escola.agenciamotum.com.br/api/bling/auth/callback
https://escola.agenciamotum.com.br/api/mercadolivre/auth/callback
```

Os aplicativos podem ser cadastrados antes da publicação. A autorização das contas deve ser concluída depois que esses callbacks estiverem acessíveis por HTTPS.

## Verificar sem alterar o Supabase

```powershell
npm.cmd run check:deploy -- --initial --database
```

O comando verifica configuração, conexão, migrations aplicadas, RLS nas tabelas da aplicação e existência de administrador master ativo. Só executa consultas: não aplica migrations, não cria usuários e não imprime credenciais.

- `OK`: item verificado.
- `FALTA`: requisito para publicação ainda não atendido.
- `PENDENTE`: integração opcional ao funcionamento inicial; precisa ser preenchida antes de usar essa funcionalidade.

Se houver erro de autenticação, confira a senha e o projeto no painel Supabase. Um teste TCP bem-sucedido não comprova que as credenciais estão corretas.

## Inicializar o banco

Em um projeto novo e vazio, após confirmar as conexões:

```powershell
npm.cmd run db:deploy
npm.cmd run seed
npm.cmd run check:deploy -- --initial --database
```

O seed cria o usuário se o e-mail não existir; não redefine senhas ou promove usuários existentes. A conta criada deve ter perfil `ADMIN` e estar ativa. Se o projeto já contiver dados, consulte [a migração de instalações anteriores](bling-supabase.md) antes de inicializar.

## Validar código e manter no Git

```powershell
npm.cmd run build:hostinger
npm.cmd --workspace apps/backend test -- --runInBand
node --test scripts/test-deploy.cjs
npm.cmd run check:deploy -- --artifacts-only
```

O workflow `.github/workflows/ci.yml` repete a validação em Linux. Cria um PostgreSQL descartável, aplica as 9 migrations, cria um administrador fictício e inicia `server.cjs` para verificar login e criação de loja. Não usa o Supabase de produção. O script de teste integrado só aceita um banco local chamado `motum_ci`.

Depois dos testes, publique as alterações no Git e confira a aba **Actions** do repositório. Nenhum workflow configura a Hostinger ou altera o banco de produção automaticamente.

## O que ficará para a Hostinger

1. O proprietário do Business importa o repositório e seleciona `main`.
2. Configura raiz `./`, Node 24, build `npm run build:hostinger` e entrada `server.cjs`.
3. Cadastra as variáveis privadas do `.env` no painel, mantendo o mesmo `JWT_SECRET`.
4. Ativa o domínio e HTTPS, publica e confere `/api/health`.
5. Entra com o master, cria as lojas reais e autoriza Bling/Mercado Livre.

O deploy não cria automaticamente o banco ou o master. Para deixar somente a publicação para o dia seguinte, conclua primeiro a inicialização e a verificação do Supabase.
