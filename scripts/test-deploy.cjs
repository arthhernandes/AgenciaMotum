const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment } = require('./check-deploy.cjs');

function fixture() {
  return {
    DATABASE_URL: 'postgresql://postgres.ref:valid-password@host.pooler.supabase.com:6543/postgres?sslmode=require',
    DIRECT_URL: 'postgresql://postgres.ref:valid-password@host.pooler.supabase.com:5432/postgres?sslmode=require',
    JWT_SECRET: 'a-secure-example-secret-with-more-than-32-characters',
    NODE_ENV: 'production', SERVE_FRONTEND: 'true',
    FRONTEND_URL: 'https://escola.agenciamotum.com.br', CORS_ORIGINS: 'https://escola.agenciamotum.com.br',
    BLING_REDIRECT_URI: 'https://escola.agenciamotum.com.br/api/bling/auth/callback',
    MELI_REDIRECT_URI: 'https://escola.agenciamotum.com.br/api/mercadolivre/auth/callback',
    MASTER_ADMIN_EMAIL: 'admin@example.test', MASTER_ADMIN_PASSWORD: 'valid-example-password'
  };
}
test('accepts production settings while marking optional integrations as pending', () => {
  const checks = validateEnvironment(fixture(), true);
  assert.equal(checks.filter(check => !check.ok && !check.optional).length, 0);
  assert.equal(checks.find(check => check.name === 'BLING_CREDENTIALS').ok, false);
});
for (const [name, change] of [
  ['missing database password', env => {env.DATABASE_URL = 'postgresql://postgres@host/postgres?sslmode=require';}],
  ['unfilled Supabase password', env => {env.DATABASE_URL = env.DATABASE_URL.replace('valid-password', '[YOUR-PASSWORD]');}],
  ['transaction pooler for migrations', env => {env.DIRECT_URL = env.DATABASE_URL;}],
  ['short JWT secret', env => {env.JWT_SECRET = 'change-me';}],
  ['callback on a different host', env => {env.BLING_REDIRECT_URI = 'https://wrong.test/api/bling/auth/callback';}],
  ['CORS on a different host', env => {env.CORS_ORIGINS = 'https://wrong.test';}],
  ['frontend URL containing credentials', env => {env.FRONTEND_URL = 'https://user:secret@escola.agenciamotum.com.br';}],
  ['missing initial administrator', env => {env.MASTER_ADMIN_EMAIL = '';}]
]) test('rejects ' + name, () => {
  const env = fixture(); change(env);
  assert.ok(validateEnvironment(env, true).some(check => !check.ok && !check.optional));
});
test('does not return secret values in diagnostics', () => {
  const env = fixture(); env.MASTER_ADMIN_PASSWORD = 'PRIVATE-CREDENTIAL-VALUE';
  const result = JSON.stringify(validateEnvironment(env, true));
  assert.equal(result.includes(env.JWT_SECRET), false);
  assert.equal(result.includes(env.MASTER_ADMIN_PASSWORD), false);
  assert.equal(result.includes('valid-password'), false);
});
