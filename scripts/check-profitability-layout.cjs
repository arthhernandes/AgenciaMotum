const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');localStorage.setItem('reports-preferences:olist-ts-comercio',JSON.stringify({type:'profitability',dateFrom:'2026-09-23',dateTo:'2026-10-22'}));},login.accessToken);
  await page.route('**/api/reports?**',route=>route.fulfill({json:{account:'Motum',listings:{summary:{offers:0,families:0,units:0,sold:0,statuses:{}},rows:[]}}}));
  await page.route('**/api/reports/profitability/inputs?**',route=>route.fulfill({json:{saved:true,taxRate:12,manualAdvertising:[],manualShipping:[]}}));
  await page.route('**/api/reports/profitability/enrichment-status',route=>route.fulfill({json:{status:'RUNNING',total:1000,processed:200,percent:20,accounts:[{account:'Motum',total:500,processed:100,shippingFilled:100,fiscalFilled:10},{account:'Outlet4u',total:500,processed:100,shippingFilled:100,fiscalFilled:10}]}}));
  const row=(id)=>({orderId:'200001717094425'+id,itemIndex:0,itemId:'MLB339645734'+id,title:'Camiseta Básica Masculina Preta Polo Original + Frete Grátis',parentTitle:'Polo Masculina Custom Slim Fit',parentSku:id===1?'5484':'8066',sku:id===1?'5484.0076':'8066.33',quantity:1,createdAt:'2026-06-30T12:00:00Z',unitPrice:145.49,revenue:145.49,commission:18.92,sellerShipping:id===1?null:15.99,fiscalCost:60,advertisingCost:0,profitBeforeTaxes:id===1?null:50.58,netProfit:null,issues:id===1?['Frete do vendedor ainda não confirmado']:[]});
  let orderReads=0;await page.route('**/api/reports/profitability?**',route=>{orderReads++;const url=new URL(route.request().url());assert.equal(url.searchParams.get('cachedOnly'),'true');assert.equal(url.searchParams.get('refresh'),'false');return route.fulfill({json:{rows:[row(1),row(2)],errors:[],offset:0,total:2,processedOrders:2,nextOffset:null,incomplete:false,fromDatabase:true}});});
  await page.route('**/api/reports/profitability/advertising?**',route=>route.fulfill({json:{results:[{itemId:'MLB3396457341',cost:0},{itemId:'MLB3396457342',cost:0}]}}));
  await page.goto('http://localhost:4201/relatorios',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Rentabilidade por pedido',exact:true}).waitFor();
  await page.locator('app-profitability-report tbody tr').first().waitFor();
  assert.equal(await page.getByRole('button',{name:/Importar pedidos|Importar publicidade|Retomar consulta/}).count(),0);
  assert.equal(await page.getByText('Consultando pedidos',{exact:true}).count(),0);
  assert.equal(orderReads,1);
  await page.getByRole('button',{name:'Atualizar relatório',exact:true}).click();
  await page.locator('app-profitability-report tbody tr').first().waitFor();
  assert.equal(orderReads,2);
  for(const mode of ['orders','sku']){
   await page.locator('app-profitability-report .tools select').selectOption(mode);
   for(const width of [1920,1440,1100,768,390]){
    await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
    const layout=await page.locator('app-profitability-report .table-wrap').evaluate(element=>{const box=element.getBoundingClientRect();return {width:element.clientWidth,scrollWidth:element.scrollWidth,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,cells:[...element.querySelectorAll('tbody td')].map(cell=>({right:cell.getBoundingClientRect().right,left:cell.getBoundingClientRect().left})),left:box.left,right:box.right};});
    assert.ok(layout.scrollWidth<=layout.width+1,JSON.stringify({mode,width,layout}));
    assert.ok(layout.cells.every(cell=>cell.left>=layout.left-1&&cell.right<=layout.right+1),'Cell outside report: '+JSON.stringify({mode,width,layout}));
    assert.ok(await page.getByRole('button',{name:mode==='orders'?'Receita: ordenar do maior para o menor':'Receita total: ordenar do maior para o menor',exact:true}).isVisible());
    console.log(JSON.stringify({mode,viewport:width,reportWidth:layout.width,scrollWidth:layout.scrollWidth,documentWidth:layout.documentWidth}));
    if(width===1440||width===768)await page.screenshot({path:'artifacts/profitability-'+mode+'-'+width+'.png',fullPage:true});
   }
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
