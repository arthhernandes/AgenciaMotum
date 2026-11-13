# Agência Motum

Sistema Angular + NestJS para catálogo Bling, anúncios Mercado Livre e auditoria por loja. O administrador master cria as lojas; o banco utiliza PostgreSQL no Supabase.

## Publicação

Repositório: `arthhernandes/AgenciaMotum`.

Domínio de produção: `https://escola.agenciamotum.com.br`.

O frontend e a API são servidos juntos por uma aplicação Node.js na Hostinger Business. O banco fica no Supabase. O procedimento completo, incluindo variáveis, criação do administrador e atualizações pelo Git, está em [Publicação na Hostinger](docs/publicacao-hostinger.md).

| Configuração no hPanel | Valor |
| --- | --- |
| Raiz | `./` |
| Node.js | 24.x ou 22.x |
| Build | `npm run build:hostinger` |
| Entrada | `server.cjs` |
| Início | `npm start` |

Use [deploy/server.env.example](deploy/server.env.example) como referência para as variáveis privadas do painel. Nunca envie um `.env` real ao Git.

## Desenvolvimento

Instale as dependências com `npm ci --include=dev`, configure `apps/backend/.env` a partir de `.env.example` e execute `npm run prisma:generate`.

- `npm run dev:backend`: API local.
- `npm run dev:frontend`: frontend local.
- `npm run build`: compila os três workspaces na ordem de dependência.
- `npm test`: testes; execute o build antes em uma instalação nova.
- `npm run db:deploy`: aplica migrations existentes ao banco configurado.
- `npm run seed`: cria o administrador inicial a partir de `MASTER_ADMIN_*`.

Detalhes da transição de Olist para Bling e da migração de um banco existente: [Bling e Supabase](docs/bling-supabase.md).
