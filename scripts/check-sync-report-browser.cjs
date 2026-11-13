const assert=require('node:assert/strict');const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());
 await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
 let started=false;
 await page.route('**/api/marketplace-accounts?*',route=>route.fulfill({json:[{id:'test-account',active:true,connected:true,hasCredentials:true}]}));
 await page.route('**/api/sync/mercadolivre/start-selected?*',route=>{started=true;return route.fulfill({json:{id:'test-execution',source:'MERCADO_LIVRE',status:'RUNNING',itemsProcessed:0}});});
 await page.route('**/api/sync/executions/test-execution?*',route=>route.fulfill({json:{id:'test-execution',source:'MERCADO_LIVRE',status:'SUCCESS',itemsProcessed:5,errors:0}}));
 await page.route('**/api/sync/daily/reports?*',route=>route.fulfill({json:[{id:'test',day:'2026-10-21',status:'PARTIAL',processed:105,errors:1,steps:[{source:'OLIST',status:'SUCCESS',processed:100,created:5,updated:95,errors:0,startedAt:'2026-10-21T09:00:00Z',finishedAt:'2026-10-21T09:10:00Z',errorMessages:[]},{source:'MERCADO_LIVRE',status:'PARTIAL',processed:5,created:0,updated:0,errors:1,startedAt:'2026-10-21T09:10:00Z',finishedAt:'2026-10-21T09:15:00Z',errorMessages:[{reference:'MLBTEST',message:'Falha simulada para conferir apresentação.'}]}]}]}));
 await page.goto('http://192.168.15.88:4201/sincronizacoes');await page.getByRole('heading',{name:'Relatório das sincronizações diárias',exact:true}).waitFor();await page.locator('.report-table').getByText('Mercado Livre',{exact:true}).waitFor();
 await page.getByText('Ver detalhes dos erros',{exact:true}).click();await page.getByText('Falha simulada para conferir apresentação.').waitFor();
 assert.equal(await page.locator('.source-cards .sync-hero').count(),2);await page.getByRole('button',{name:'Sincronizar Mercado Livre',exact:true}).click();await page.locator('.current-card').getByText('5 itens processados',{exact:true}).waitFor();assert.equal(started,true);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({bothIntegrationCardsVisible:true,errorDetailsVisible:true,backgroundSyncAndProgressVerified:true,errors}));
}finally{await browser.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
