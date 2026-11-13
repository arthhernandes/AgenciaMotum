const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');

(async () => {
  const login = await fetch('http://localhost:3001/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' })
  }).then(response => response.json());
  assert.ok(login.accessToken);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(token => localStorage.setItem('token', token), login.accessToken);
    let retries = 0;
    await page.route('**/api/listings/grouped?**', async route => {
      const search = new URL(route.request().url()).searchParams.get('search') || '';
      if (search === 'MLBERROR') return route.fulfill({ status: 422, json: { message: 'Invalid search' } });
      if (search === 'MLBRETRY' && retries++ === 0) return route.fulfill({ status: 503, json: {} });
      await new Promise(resolve => setTimeout(resolve, search === 'MLBSLOW' ? 1800 : 600));
      const data = search === 'MLBEMPTY' ? [] : [{ id: search || 'initial', itemId: 'MLB123', title: search || 'Initial listing', price: 100, status: 'active', availableQuantity: 1, soldQuantity: 0, variants: [], children: [], skuStatus: 'missing' }];
      await route.fulfill({ json: { data, pagination: { page: 1, limit: 50, total: data.length, pages: 1 } } }).catch(() => {});
    });
    for (const metric of ['prices', 'sales', 'visits']) await page.route('**/api/listings/' + metric + '?**', route => route.fulfill({ json: { items: [] } }));
    await page.goto('http://localhost:4201/anuncios');
    const progress = page.locator('.search-progress');
    const search = page.locator('input[matInput]').first();
    await page.locator('.title-link').first().waitFor();
    await search.fill('MLBSLOW');
    await progress.waitFor();
    assert.match(await progress.innerText(), /MLBSLOW/);
    assert.equal(await page.locator('.list-scroll').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('.empty-state').count(), 0);
    await page.waitForTimeout(450);
    await search.fill('MLBNEW');
    await page.getByRole('button', { name: 'MLBNEW', exact: true }).waitFor();
    await progress.waitFor({ state: 'hidden' });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.title-link').first().innerText(), 'MLBNEW');
    await search.fill('MLBEMPTY');
    await progress.waitFor();
    assert.equal(await page.locator('.empty-state').count(), 0);
    await page.locator('.empty-state').waitFor();
    await progress.waitFor({ state: 'hidden' });
    await search.fill('MLBERROR');
    await page.getByRole('alert').waitFor();
    await progress.waitFor({ state: 'hidden' });
    await search.fill('MLBRETRY');
    await page.getByText(/Tentando novamente automaticamente/).waitFor();
    await page.getByRole('button', { name: 'MLBRETRY', exact: true }).waitFor();
    await progress.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ immediateLoading: true, staleResponseCancelled: true, emptyState: true, errorState: true, automaticRetryFeedback: true, noPageErrors: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
