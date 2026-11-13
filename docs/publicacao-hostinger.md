# Hostinger via Git + Supabase

Frontend Angular e backend NestJS são publicados como **uma aplicação Node.js**. O mesmo domínio serve o site e `/api`; o PostgreSQL fica no Supabase. Não é necessário manter este computador ligado, usar túnel ou criar uma segunda aplicação de hospedagem.

Este guia usa a hospedagem Node.js gerenciada do hPanel. Confirme que seu plano oferece **aplicações Node.js**. Em uma VPS, os mesmos comandos de build e início funcionam, mas o processo, o proxy HTTPS e a atualização por Git precisam ser configurados no servidor.

## 1. Preparar o repositório

Crie um repositório privado no GitHub. Na pasta do projeto:

```powershell
git status
git add .
git commit -m "Prepara Bling, lojas e deploy Hostinger com Supabase"
git remote add origin https://github.com/arthhernandes/AgenciaMotum.git
git push -u origin main
```

Se `origin` já existir, confira seu destino e não repita `remote add`. O projeto já tem `.gitignore` para `.env`, dependências e builds. Envie o código, `package-lock.json`, scripts e migrations; **os valores reais das variáveis ficam fora do Git**. O comando `git status` deve ser revisado antes de criar o commit.

## 2. Criar o banco no Supabase

Crie o projeto e, em **Connect**, copie suas duas URLs:

- `DATABASE_URL`: transaction pooler, porta 6543, com `pgbouncer=true&connection_limit=5&sslmode=require`.
- `DIRECT_URL`: session pooler, porta 5432, com `sslmode=require`. Também pode ser conexão direta se o ambiente tiver IPv6.

Use o host, região e referência exibidos pelo Supabase. Não use a chave `anon` ou `service_role` como senha do PostgreSQL. Codifique os caracteres especiais da senha na URL. As tabelas do sistema têm RLS e não são acessíveis pelas roles públicas da Data API; o backend usa uma conexão PostgreSQL confiável.

Para um banco novo, configure essas duas variáveis e as variáveis `MASTER_ADMIN_*` em `apps/backend/.env`, usando os exemplos do projeto. Então, na raiz:

```powershell
npm.cmd ci --include=dev
npm.cmd run prisma:generate
npm.cmd run db:deploy
npm.cmd run seed
```

O seed exige uma senha master de pelo menos 12 caracteres e não cria lojas fixas. Para transferir dados de uma instalação existente, siga [bling-supabase.md](bling-supabase.md) antes de aplicar migrations ao banco novo. A migração de dados históricos é uma etapa distinta da publicação do código.

## 3. Importar o Git na Hostinger

No hPanel, crie um site do tipo **aplicação Node.js** e escolha **importar repositório Git**. Autorize a Hostinger a acessar o repositório privado e selecione a branch `main`.

Use as seguintes configurações, relativas à raiz do repositório:

| Campo | Valor |
| --- | --- |
| Diretório raiz / Root directory | `./` |
| Gerenciador de pacotes | npm |
| Node.js | 24.x (ou 22.x) |
| Framework, se solicitado | Express / aplicação Node.js personalizada |
| Comando de build | `npm run build:hostinger` |
| Arquivo de entrada / Entry file | `server.cjs` |
| Comando de início, se solicitado | `npm start` |
| Diretório de saída, se obrigatório | `.` |

Mantenha o diretório raiz em `./`, pois os workspaces compartilham dependências. O deploy precisa preservar `server.cjs`, `apps/backend/dist`, `apps/frontend/dist/frontend/browser`, as dependências e o cliente Prisma gerado. **Não configure apenas a pasta do Angular como saída da aplicação Node.js.** Se o painel interpretar esse campo de outra maneira, confira os arquivos preservados e os logs antes de liberar o domínio.

A Hostinger instala as dependências. Se houver campo de comando de instalação, use `npm ci --include=dev`: TypeScript, Nest CLI, Angular CLI e Prisma CLI são necessários no build. Não execute `npm prune --omit=dev` antes de compilar. O build de produção deve usar os scripts deste repositório, sem `ng serve` ou `start:dev`.

## 4. Variáveis no painel

Cadastre as variáveis de [deploy/server.env.example](../deploy/server.env.example) no painel da aplicação antes do primeiro build. Substitua `https://escola.agenciamotum.com.br` pelo domínio real.

Essenciais:

- `NODE_ENV=production` e `SERVE_FRONTEND=true`.
- `DATABASE_URL` e `DIRECT_URL` do Supabase.
- `JWT_SECRET`: um segredo longo e aleatório, mantido nas atualizações.
- `FRONTEND_URL` e `CORS_ORIGINS`: a origem HTTPS do site, sem caminho.
- Credenciais e callbacks do Bling e Mercado Livre.

Não defina `PORT`: a aplicação aceita a porta fornecida pela Hostinger. `API_PORT` é o fallback para execução local/VPS.

O frontend usa a API no mesmo domínio por padrão; mantenha `apps/frontend/src/assets/app-config.js` com `apiOrigin: ''`. O navegador não recebe senha do Supabase ou segredos dos aplicativos.

As variáveis `MASTER_ADMIN_*` são usadas somente pelo seed. Depois da criação inicial, não é necessário mantê-las no painel. O deploy normal não executa seed nem redefine usuários. Para o assistente, configure um provedor remoto; `localhost` da Hostinger não aponta para o Ollama deste computador.

## 5. Domínio e OAuth

Conecte o domínio à aplicação e ative HTTPS. Cadastre nos provedores exatamente:

```text
https://escola.agenciamotum.com.br/api/bling/auth/callback
https://escola.agenciamotum.com.br/api/mercadolivre/auth/callback
```

Os mesmos endereços devem estar em `BLING_REDIRECT_URI` e `MELI_REDIRECT_URI`. Se estiver usando domínio temporário, ajuste os callbacks ao trocar para o definitivo.

Mantenha uma instância do backend. As sincronizações e rotinas agendadas rodam dentro do processo Node.js. Confirme que o plano mantém o processo ativo para executar os agendamentos mesmo sem visitas; se o plano suspender a aplicação, será necessário um serviço sempre ativo ou VPS.

## 6. Validar a primeira publicação

1. Abra `https://escola.agenciamotum.com.br/api/health`: o JSON deve conter `api: "ok"` e `postgres: "ok"`.
2. Abra `/login`, entre com o master e crie uma loja em **Contas**.
3. Atualize a página diretamente em `/contas` para conferir o roteamento Angular.
4. Autorize Bling e Mercado Livre para essa loja e execute a primeira sincronização.
5. Confira os logs do deploy e do processo. O sistema deve continuar acessível com o computador local desligado.

## 7. Atualizar pelo Git

Com a integração de deploy automático ativada para `main`, o fluxo é:

```powershell
git add .
git commit -m "Descreve a atualização"
git push origin main
```

A Hostinger recebe o push, compila e publica a versão. Acompanhe o resultado no painel. Dados do Supabase e credenciais do painel permanecem fora do código publicado.

Quando uma atualização incluir uma migration de banco, revise-a e execute `npm.cmd run db:deploy` com o `.env` apontando para o Supabase antes de liberar a versão que depende dela. **Não use `prisma migrate dev` ou `db push` no banco de produção.** Migrations não são executadas automaticamente pelo build ou início da aplicação. Reverter o código não reverte alterações do banco; mantenha backup e migrations compatíveis com a versão em execução.

Documentação oficial: [Hostinger com Git e Node.js](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), [monorepos na Hostinger](https://www.hostinger.com/support/how-to-deploy-monorepos-with-npm-yarn-or-pnpm-on-hostinger/), [Prisma no Supabase](https://supabase.com/docs/guides/database/prisma).
