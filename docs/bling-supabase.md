# Bling, lojas e Supabase

## Configuração inicial

O backend NestJS continua responsável por autenticação, permissões e acesso ao banco via Prisma. O Supabase hospeda o PostgreSQL; não é necessário usar Supabase Auth ou expor chaves de banco no Angular.

1. Crie o projeto no Supabase e copie as URLs da janela **Connect** para o `.env` do backend. Use `.env.example` como referência.
2. Configure `DATABASE_URL` com o transaction pooler (porta 6543, `pgbouncer=true`) e `DIRECT_URL` com a conexão direta ou session pooler (porta 5432). A conexão direta pode exigir IPv6. Use `sslmode=require` e codifique caracteres especiais da senha na URL. O backend precisa de uma role confiável que consiga acessar as tabelas com RLS, como a role PostgreSQL do projeto; as roles `anon` e `authenticated` não têm acesso.
3. Configure `JWT_SECRET` com um segredo forte, `MASTER_ADMIN_EMAIL`, `MASTER_ADMIN_PASSWORD` (12 caracteres ou mais) e, opcionalmente, `MASTER_ADMIN_NAME`.
4. Execute na raiz:

```powershell
npm.cmd ci
npm.cmd run prisma:generate
npm.cmd --workspace apps/backend exec prisma migrate deploy
npm.cmd run seed
npm.cmd run build
```

O seed cria somente o administrador master (`ADMIN`), sem senha padrão e sem lojas de demonstração. Executá-lo novamente não redefine a senha de um usuário existente.

## Integrações

Cadastre um aplicativo no Bling e configure `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET` e `BLING_REDIRECT_URI`. A URL de retorno deve terminar em `/api/bling/auth/callback` e coincidir com o cadastro do aplicativo. Habilite os escopos de consulta de produtos, variações e saldos de estoque necessários. O aplicativo é compartilhado pelo sistema, mas cada loja autoriza sua própria conta e mantém tokens separados. O fluxo usa authorization code, state de uso único e renovação de tokens no servidor.

Para Mercado Livre, configure `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI` e a permissão de acesso offline. Configure também `FRONTEND_URL` e `CORS_ORIGINS` para a implantação.

Faça login como master, abra **Contas**, preencha **Criar loja** e autorize Bling e Mercado Livre. A loja recém-criada é selecionada automaticamente. As outras lojas aparecem no seletor. Produtos e estoque pertencem à conexão Bling da loja; modelos fiscais também são separados. Os usuários continuam seguindo os perfis e permissões globais existentes: este projeto não implementa contas independentes de clientes com associação de usuários por loja.

## Migração de uma instalação anterior

Faça um backup do PostgreSQL anterior e restaure os dados e o histórico `_prisma_migrations` em um projeto Supabase vazio antes de executar `prisma migrate deploy`. Não aplique o backup sobre tabelas já criadas pelas mesmas migrations. Uma instalação nova usa apenas `migrate deploy`.

A migration de transição preserva o histórico de Olist, desativa as integrações antigas e remove as lojas fixas da seleção. Olist permanece apenas como valor histórico no banco. IDs e tokens da Olist não são convertidos em credenciais do Bling. Crie as novas lojas e importe seus catálogos pelo Bling. A migration não apaga os registros anteriores; vínculos históricos não são transferidos automaticamente entre provedores.

A migração real depende das credenciais do projeto Supabase. Nenhuma conexão remota ou transferência de dados é feita automaticamente pelos comandos de build/teste.

## Contratos da API

A integração usa `/produtos` com `pagina`, `limite` e filtro de inclusão, `/produtos/variacoes/{idProdutoPai}`, `/produtos/{idProduto}` e `/estoques/saldos` com `idsProdutos[]`. O saldo virtual desconta reservas; não há compartilhamento de estoque entre lojas. SKUs alfanuméricos e sua pontuação são preservados. Imagens vêm de `midia.imagens`; dados fiscais de `tributacao`.

Referências: [OAuth Bling](https://developer.bling.com.br/aplicativos), [contratos da API Bling](https://developer.bling.com.br/referencia), [Prisma no Supabase](https://supabase.com/docs/guides/database/prisma).
