const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const placeholder = /PROJECT_REF|POOLER_HOST|SENHA|SUBSTITUA|change-me|CHANGE_ME|YOUR[_-]/i;
function validateEnvironment(env, initial = false) {
  const checks = [];
  const add = (name, ok, hint, optional = false) => checks.push({ name, ok: Boolean(ok), hint, optional });
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    let url;
    try { url = new URL(env[key]); } catch {}
    let password = '';
    try { password = decodeURIComponent(url?.password ?? ''); } catch {}
    add(key, url && ['postgresql:', 'postgres:'].includes(url.protocol) && url.username && password && !placeholder.test(env[key]) && url.searchParams.get('sslmode') === 'require' && (key !== 'DIRECT_URL' || url.port !== '6543'), 'Preencha a conexão PostgreSQL real com sslmode=require; DIRECT_URL usa conexão direta ou session pooler (5432).');
  }
  add('JWT_SECRET', env.JWT_SECRET?.length >= 32 && !placeholder.test(env.JWT_SECRET), 'Use um segredo aleatório com pelo menos 32 caracteres.');
  let origin;
  try {
    const url = new URL(env.FRONTEND_URL);
    if (url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash) origin = url.origin;
  } catch {}
  add('FRONTEND_URL', origin, 'Use somente a origem HTTPS do site.');
  add('CORS_ORIGINS', origin && (env.CORS_ORIGINS ?? '').split(',').map(x => x.trim()).includes(origin), 'Inclua a origem HTTPS do frontend.');
  add('NODE_ENV', env.NODE_ENV === 'production', 'Configure production.');
  add('SERVE_FRONTEND', env.SERVE_FRONTEND === 'true', 'Configure true para servir Angular e API juntos.');
  for (const [provider, callback] of [['BLING', 'bling'], ['MELI', 'mercadolivre']]) {
    add(provider + '_REDIRECT_URI', origin && env[provider + '_REDIRECT_URI'] === `${origin}/api/${callback}/auth/callback`, 'O callback deve usar o domínio do frontend e o caminho correto.');
    add(provider + '_CREDENTIALS', env[provider + '_CLIENT_ID'] && env[provider + '_CLIENT_SECRET'] && !placeholder.test(env[provider + '_CLIENT_SECRET']), 'Preencha Client ID e Client Secret para autorizar esta integração.', true);
  }
  if (initial) {
    add('MASTER_ADMIN_EMAIL', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.MASTER_ADMIN_EMAIL ?? ''), 'Informe o e-mail do administrador inicial.');
    add('MASTER_ADMIN_PASSWORD', env.MASTER_ADMIN_PASSWORD?.length >= 12 && !placeholder.test(env.MASTER_ADMIN_PASSWORD), 'Defina a senha inicial com pelo menos 12 caracteres.');
  }
  add('ASSISTENTE_IA', env.CHAT_PROVIDER === 'qwen' ? env.CHAT_BASE_URL && !/localhost|127\.0\.0\.1/.test(env.CHAT_BASE_URL) : env.OPENAI_API_KEY, 'Configure um provedor remoto se for usar o assistente.', true);
  return checks;
}

async function databaseChecks(env, report) {
  const { PrismaClient } = require('@prisma/client');
  const databaseUrl = new URL(env.DATABASE_URL);
  databaseUrl.searchParams.set('connect_timeout', '10');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
  try {
    await prisma.$queryRaw`SELECT 1`;
    report('BANCO_CONEXAO', true);
    const [table] = await prisma.$queryRaw`SELECT to_regclass('public._prisma_migrations')::text AS name`;
    const rows = table.name ? await prisma.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations` : [];
    const applied = new Set(rows.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name));
    const local = fs.readdirSync(path.join(root, 'apps/backend/prisma/migrations'), {withFileTypes:true}).filter(item => item.isDirectory()).map(item => item.name);
    const pending = local.filter(name => !applied.has(name));
    report('BANCO_MIGRATIONS', !pending.length && !rows.some(row => !row.finished_at && !row.rolled_back_at), pending.length ? `${pending.length} migration(s) pendente(s).` : 'Verifique se há uma migration interrompida.');
    const tables = await prisma.$queryRaw`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN ('User','Product','ProductVariant','MarketplaceAccount','MarketplaceListing','MarketplaceListingVariant','ListingProductLink','AuditIssue','SyncExecution','AuditLog','IntegrationSnapshot','NcmEntry')`;
    report('BANCO_RLS', tables.length === 12 && tables.every(table => table.rowsecurity), 'As 12 tabelas da aplicação devem estar protegidas por RLS.');
    if (tables.some(table => table.tablename === 'User')) {
      report('BANCO_MASTER', await prisma.user.count({where:{role:'ADMIN',active:true}}) > 0, 'Execute npm run seed com os dados do administrador inicial.');
    }
  } catch (error) {
    const rawCode = error.code ?? error.errorCode;
    const message = String(error.message ?? '');
    const code = /^[A-Z0-9]{1,12}$/.test(rawCode ?? '') ? rawCode
      : /Authentication failed|password authentication failed/i.test(message) ? 'AUTHENTICATION_FAILED'
      : /Tenant or user not found/i.test(message) ? 'PROJECT_OR_USER_NOT_FOUND'
      : /Can't reach database server|timed?\s*out|ECONNREFUSED/i.test(message) ? 'NETWORK_UNREACHABLE'
      : 'CONNECTION_ERROR';
    report('BANCO_CONEXAO', false, `Falha ${code}. Confira a conexão e a disponibilidade do projeto; credenciais não são exibidas.`);
  } finally { await prisma.$disconnect(); }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  let failed = false;
  const report = (name, ok, hint = '', optional = false) => {
    console.log(`${ok ? 'OK' : optional ? 'PENDENTE' : 'FALTA'} ${name}${!ok && hint ? ': ' + hint : ''}`);
    if (!ok && !optional) failed = true;
  };
  if (!args.has('--artifacts-only')) {
    const filename = path.join(root, 'apps/backend/.env');
    let env = {...process.env};
    if (fs.existsSync(filename)) env = {...require('dotenv').parse(fs.readFileSync(filename)), ...env};
    const checks = validateEnvironment(env, args.has('--initial'));
    checks.forEach(check => report(check.name, check.ok, check.hint, check.optional));
    if (args.has('--database') && checks.filter(check => /^(DATABASE_URL|DIRECT_URL)$/.test(check.name)).every(check => check.ok)) await databaseChecks(env, report);
  }
  for (const file of ['server.cjs','apps/backend/dist/src/main.js','apps/backend/dist/src/common/frontend-hosting.js','packages/shared/dist/index.js','apps/frontend/dist/frontend/browser/index.html','apps/frontend/dist/frontend/browser/assets/app-config.js']) report('ARQUIVO ' + file, fs.existsSync(path.join(root,file)), 'Execute npm run build:hostinger.');
  try {
    const tracked = execFileSync('git', ['ls-files','-z'], {cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0');
    report('SEGREDOS_FORA_DO_GIT', !tracked.some(file => /(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.example')), 'Remova arquivos .env reais do versionamento.');
  } catch { report('GIT', false, 'Execute dentro do repositório Git.'); }
  console.log('Esta verificação não altera o banco e nunca exibe valores de credenciais.');
  process.exitCode = failed ? 1 : 0;
}
module.exports = {validateEnvironment};
if (require.main === module) main().catch(() => {console.error('Falha na verificação. Confira a instalação das dependências.'); process.exitCode = 1;});
