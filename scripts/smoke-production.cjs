// Uses only the disposable local CI database. Never runs against Supabase.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

async function main() {
  const database = new URL(process.env.DATABASE_URL || 'postgresql://missing');
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(database.hostname) && database.pathname === '/motum_ci', 'Use somente um PostgreSQL local descartável chamado motum_ci.');
  assert.ok(process.env.MASTER_ADMIN_EMAIL && process.env.MASTER_ADMIN_PASSWORD, 'Execute o seed no banco de teste antes.');
  const port = 3333, origin = `http://127.0.0.1:${port}`;
  let exited = false, logs = '';
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: path.resolve(__dirname, '..'),
    env: {...process.env, PORT: String(port), NODE_ENV:'production', SERVE_FRONTEND:'true', FRONTEND_URL:origin, CORS_ORIGINS:origin, JWT_SECRET:'isolated-ci-session-secret-with-more-than-32-characters'},
    stdio: ['ignore','pipe','pipe']
  });
  child.on('exit', () => {exited = true;});
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {logs = (logs + data).slice(-4000);});
  const api = async (url, token, body) => {
    const res = await fetch(origin + url, {method:body ? 'POST' : 'GET', headers:{...(body ? {'Content-Type':'application/json'} : {}), ...(token ? {Authorization:'Bearer '+token} : {})}, ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(10000)});
    assert.ok(res.ok, `${url}: HTTP ${res.status}`);
    return res.json();
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !exited; attempt++) {
      try {const health = await api('/api/health'); ready = health.api === 'ok' && health.postgres === 'ok';} catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve,500));
    }
    assert.ok(ready, 'A aplicação não iniciou com o PostgreSQL de teste. ' + logs);
    for (const url of ['/', '/login', '/contas']) {
      const res = await fetch(origin + url, {headers:{Accept:'text/html'}});
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<app-root/);
    }
    assert.equal((await fetch(origin+'/api/route-not-found')).status,404);
    assert.equal((await fetch(origin+'/api/marketplace-accounts/business')).status,401);
    const login = await api('/api/auth/login', null, {email:process.env.MASTER_ADMIN_EMAIL,password:process.env.MASTER_ADMIN_PASSWORD});
    assert.ok(login.accessToken);
    assert.equal(login.user.role,'ADMIN');
    assert.deepEqual(await api('/api/marketplace-accounts/business',login.accessToken),[]);
    const store = await api('/api/marketplace-accounts/business',login.accessToken,{name:'Loja de validação CI'});
    assert.ok(store.id);
    const stores = await api('/api/marketplace-accounts/business',login.accessToken);
    assert.ok(stores.some(row => row.id === store.id && row.displayName === 'Loja de validação CI'));
    const accounts = await api('/api/marketplace-accounts?marketplaceAccountId='+encodeURIComponent(store.id),login.accessToken);
    assert.equal(accounts.length,1);
    assert.equal(accounts[0].marketplace,'MERCADO_LIVRE');
    assert.equal(accounts[0].hasCredentials,false);
    assert.equal(accounts[0].accessToken,undefined);
    console.log('Produção validada no banco descartável: frontend, API, login master e criação de loja.');
  } finally {
    if (!exited) {
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit',resolve)),new Promise(resolve => setTimeout(resolve,5000))]);
      if (!exited) child.kill('SIGKILL');
    }
  }
}
main().catch(error => {console.error(error.message); process.exitCode=1;});
