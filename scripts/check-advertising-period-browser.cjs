const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 const accounts=await fetch('http://localhost:3001/api/marketplace-accounts/business',{headers:{Authorization:'Bearer '+login.accessToken}}).then(r=>r.json());const account=accounts[0];assert.ok(account?.id);
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(30000);const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
  await page.addInitScript(({token,account})=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId',account);localStorage.setItem('reports-preferences:'+account,JSON.stringify({type:'profitability',dateFrom:'2026-09-27',dateTo:'2026-10-26'}));},{token:login.accessToken,account:account.id});
  let inputs={saved:true,taxRate:0,manualAdvertising:[],manualShipping:[]};
  await page.route('**/api/reports/profitability/inputs?**',async route=>{if(route.request().method()==='POST'){inputs={saved:true,...route.request().postDataJSON()};await route.fulfill({json:{saved:true}});}else await route.fulfill({json:inputs});});
  await page.route('**/api/reports/profitability?**',route=>route.fulfill({json:{offset:0,total:2,processedOrders:2,nextOffset:null,incomplete:false,rows:[
    {orderId:'2000018686744394',itemIndex:0,itemId:'MLB4486643003',title:'Calça Levis',sku:'5694.18',quantity:1,createdAt:'2026-09-28T19:58:29Z',unitPrice:299.99,revenue:299.99,commission:45,sellerShipping:50.9,fiscalCost:119,profitBeforeTaxes:85.09,advertisingCost:111.86,advertisingSource:'Product Ads · rateado',issues:[]},
    {orderId:'2',itemIndex:0,itemId:'MLB4486643003',title:'Calça Levis',sku:'5694.18',quantity:1,createdAt:'2026-10-14T19:00:00Z',unitPrice:321.98,revenue:321.98,commission:50,sellerShipping:52.98,fiscalCost:119,profitBeforeTaxes:100,issues:[]}
  ],errors:[]}}));
  let summaryReady=false,summaryImports=0;
  await page.route('**/api/reports/profitability/advertising-summary?**',route=>route.fulfill({json:summaryReady?{cost:231.92,complete:true,verificationRequired:false}:{cost:null,complete:false,verificationRequired:true}}));
  await page.route('**/api/reports/profitability/import-advertising-summary?**',route=>{summaryReady=true;summaryImports++;return route.fulfill({json:{cost:231.92,complete:true}});});
  await page.route('**/api/reports/profitability/import-costs?**',route=>route.fulfill({json:{rows:[],nextOffset:null}}));
  await page.route('**/api/reports/profitability/import-advertising-allocation?**',route=>route.fulfill({json:{nextOffset:null}}));
  await page.route('**/api/reports/profitability/advertising-allocation?**',route=>route.fulfill({json:{results:[
    {orderId:'2000018686744394',itemIndex:0,cost:0,source:'Product Ads · período ativo',message:null},
    {orderId:'2',itemIndex:0,cost:12.2,source:'Product Ads · período ativo',message:null,orders:2,periodCost:24.4,activeFrom:'2026-10-03',activeTo:'2026-10-26'}
  ]}}));
  await page.goto('http://localhost:4201/relatorios',{waitUntil:'domcontentloaded'});
  const report=page.locator('app-profitability-report');await report.getByText('Sem gasto',{exact:true}).first().waitFor();
  assert.equal(summaryImports,1,'An unverified selected period must be confirmed automatically');
  const details=report.locator('.ad-details').first();await details.locator('summary').click();assert.match(await details.innerText(),/24,40/);assert.match(await details.innerText(),/03\/10\/2026/);assert.ok((await details.locator('.ad-popover').boundingBox()).width>=240);await details.locator('summary').click();
  const input=page.getByRole('spinbutton',{name:'Publicidade do pedido 2000018686744394 item 1',exact:true});assert.equal(await input.inputValue(),'0');
  assert.equal(await page.getByRole('spinbutton',{name:'Publicidade do pedido 2 item 1',exact:true}).inputValue(),'12.2');
  assert.match(await report.locator('tbody tr').first().innerText(),/85,09/);
  const summary=report.locator('.metrics article').filter({hasText:'Resultado do período após Product Ads'});assert.match(await summary.innerText(),/-R\$\s*46,83/);
  await input.fill('10');await input.blur();assert.match(await report.locator('tbody tr').first().innerText(),/75,09/);assert.match(await summary.innerText(),/-R\$\s*46,83/);
  await report.getByRole('button',{name:'Importar dados',exact:true}).click();await report.getByText('Gasto do anúncio dividido igualmente entre todas as vendas dele na parte ativa da campanha dentro do período selecionado.',{exact:false}).waitFor();assert.equal(await input.inputValue(),'10');
  const downloaded=page.waitForEvent('download');await report.getByRole('button',{name:'Baixar CSV',exact:true}).click();const file=await downloaded,csv=require('fs').readFileSync(await file.path(),'utf8');assert.match(csv,/Resumo do período/);assert.match(csv,/-46,83/);assert.ok(!csv.includes('111,86'));
  assert.ok(!requests.includes('/api/reports/profitability/advertising'));assert.deepEqual(errors,[]);
  let refreshed=0;
  await page.route('**/api/listing-links/sku/preview?**',route=>{assert.equal(route.request().postDataJSON().reference,'MLB4486643003');return route.fulfill({json:{id:'sku-review'}});});
  await page.route('**/api/listing-links/sku/sku-review/confirm?**',route=>route.fulfill({json:{success:true,message:'Vínculo salvo',linkedItems:[]}}));
  await page.route('**/api/chat/listing-variations?**',route=>route.fulfill({json:{rows:[]}}));
  await page.route('**/api/reports/profitability/refresh-listing?**',route=>{refreshed++;assert.equal(route.request().postDataJSON().itemId,'MLB4486643003');return route.fulfill({json:{rows:[
    {orderId:'2000018686744394',itemIndex:0,itemId:'MLB4486643003',title:'Calça Levis',sku:'NEW.1',quantity:1,createdAt:'2026-09-28T19:58:29Z',unitPrice:299.99,revenue:299.99,commission:45,sellerShipping:50.9,fiscalCost:109,profitBeforeTaxes:95.09,issues:[]},
    {orderId:'2',itemIndex:0,itemId:'MLB4486643003',title:'Calça Levis',sku:'NEW.2',quantity:1,createdAt:'2026-10-14T19:00:00Z',unitPrice:321.98,revenue:321.98,commission:50,sellerShipping:52.98,fiscalCost:119,profitBeforeTaxes:100,issues:[]}
  ]}});});
  const credit=page.getByRole('spinbutton',{name:'Frete comprador do pedido 2000018686744394 item 1',exact:true});await credit.fill('2');await credit.blur();
  await report.getByRole('button',{name:'Corrigir SKU do anúncio MLB4486643003',exact:true}).first().click();
  const skuDialog=page.getByRole('dialog');await skuDialog.getByLabel('SKU pai na Olist',{exact:true}).fill('NEW');await skuDialog.getByRole('button',{name:'Corrigir SKUs e vincular',exact:true}).click();await skuDialog.getByRole('button',{name:'Fechar',exact:true}).click();
  await report.getByText('Dados do anúncio atualizados no relatório.',{exact:true}).waitFor();assert.equal(refreshed,1);assert.match(await report.locator('tbody tr').first().innerText(),/NEW\.1/);assert.equal(await input.inputValue(),'10');assert.equal(await credit.inputValue(),'2');assert.match(await report.locator('tbody tr').first().innerText(),/87,09/);
  await page.route('**/api/chat/listing-fiscal?**',route=>{assert.equal(route.request().postDataJSON().reference,'MLB4486643003');return route.fulfill({json:{actionId:'fiscal-preview',draft:{regime:'',regimeLocked:false,regimeConflict:false,rows:[]}}});});
  await page.route('**/api/chat/actions/fiscal-preview/cancel?**',route=>route.fulfill({json:{}}));
  await report.getByRole('button',{name:'Dados fiscais do anúncio MLB4486643003',exact:true}).first().click();const fiscalDialog=page.getByRole('dialog');await fiscalDialog.getByRole('heading',{name:'Dados fiscais',exact:true}).waitFor();
  const regime=fiscalDialog.getByRole('combobox',{name:'Regime tributário do produto',exact:true}),apply=fiscalDialog.getByRole('button',{name:'Aplicar alterações',exact:true});assert.equal(await apply.isDisabled(),true);await regime.selectOption('simples');assert.equal(await apply.isEnabled(),true);await regime.selectOption('normal');assert.equal(await regime.inputValue(),'normal');await fiscalDialog.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(refreshed,1);
  await page.route('**/api/reports/profitability/advertising-allocation?**',route=>route.fulfill({json:{results:[{orderId:'2',itemIndex:0,cost:null,source:null,message:'Campanha identificada. Histórico de gastos incompleto.',activeFrom:'2026-10-03',activeTo:'2026-10-26',orders:2,periodCost:null}]}}));
  await page.reload({waitUntil:'domcontentloaded'});await report.locator('.ad-status-pending').waitFor();
  const pending=report.locator('tbody tr').nth(1);assert.ok(!(await pending.innerText()).includes('Histórico de gastos incompleto'));
  await pending.getByText('Ver detalhes',{exact:true}).click();assert.match(await pending.innerText(),/Histórico de gastos incompleto/);
  assert.equal(await pending.locator('.ad-status-pending span').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 243, 214)');
  assert.equal(await pending.locator('.ad-formula').count(),0);
  console.log(JSON.stringify({reportListingActions:true,savedSkuRefresh:true,sameAdActiveCampaignAllocation:true,septemberOrderUnaffectedByOctoberSpend:true,manualPreserved:true,periodExpenseDeductedOnce:true,csv:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
