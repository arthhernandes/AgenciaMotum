const assert=require('node:assert/strict');const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1536,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let release,progressId,polls=0;
 const row={id:'listing',itemId:'MLB1',title:'Produto teste',status:'active',price:100,availableQuantity:1,soldQuantity:50,variants:[],children:[],skuStatus:'missing'};
 await page.addInitScript(t=>{localStorage.setItem('token',t);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
 await page.route('**/api/**',route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(path==='/api/listings/grouped'){
   if(url.searchParams.get('sortBy')==='sold'){progressId=url.searchParams.get('progressId');assert.ok(progressId);return new Promise(resolve=>release=()=>route.fulfill({json:{data:[{...row,periodSoldQuantity:35,periodSalesFrom:url.searchParams.get('dateFrom'),periodSalesTo:url.searchParams.get('dateTo')}],pagination:{total:735,page:1,limit:50,pages:15}}}).then(resolve));}
   return route.fulfill({json:{data:[row],pagination:{total:735,page:1,limit:50,pages:15}}});
  }
  if(path==='/api/listings/sales-progress'){polls++;return route.fulfill({json:{percent:polls===1?20:65,completed:polls===1?6:20,total:30,status:'LOADING'}});}
  if(['/api/listings/sales','/api/listings/visits','/api/listings/prices'].includes(path))return route.fulfill({json:{items:[{itemId:'MLB1',soldQuantity:1,visits:10,amount:100}]}});
  if(req.method()!=='GET')throw Error('Unexpected write '+path);return route.continue();
 });
 await page.goto('http://localhost:4201/anuncios');await page.locator('.title-link').first().waitFor();await page.locator('.mat-column-sold .sort-column').click();await page.getByText('65%',{exact:true}).waitFor();
 assert.equal(await page.locator('.search-progress [role="progressbar"]').getAttribute('aria-valuenow'),'65');assert.ok(release);await release();await page.locator('.search-progress').waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-listings')).rankingPercent),100);assert.deepEqual(errors,[]);console.log(JSON.stringify({numericPercentage:true,determinateBar:true,realBackendProgress:true,completeAt100:true,noPageErrors:true}));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
