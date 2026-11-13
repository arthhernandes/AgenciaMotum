const assert=require('node:assert/strict');const{chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let todayCalls=0,fullCalls=0,release;
 await page.addInitScript(t=>{localStorage.setItem('token',t);localStorage.setItem('selectedMarketplaceAccountId','cmt0hm1ij0000v2usd4sd5q4h');},login.accessToken);
 await page.route('**/api/**',route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(path==='/api/sync/mercadolivre/progress')return route.fulfill({json:todayCalls?{id:'today-sync',status:'RUNNING',processed:1,total:null,percent:50}:{id:'previous',status:'SUCCESS',processed:6000,total:6000,percent:100}});
  if(path==='/api/sync/mercadolivre/sync-new-today'){todayCalls++;assert.equal(url.searchParams.get('marketplaceAccountId'),'cmt0hm1ij0000v2usd4sd5q4h');return new Promise(resolve=>{release=()=>route.fulfill({json:{processed:3,errors:[],scope:'today',day:'2026-11-04'}}).then(resolve);});}
  if(path==='/api/sync/mercadolivre/sync-selected'){fullCalls++;return route.fulfill({json:{processed:6000,errors:[]}});}
  return req.method()==='GET'?route.continue():route.fulfill({json:{}});
 });
 await page.goto('http://localhost:4201/anuncios');await page.getByRole('button',{name:'Sincronizar anúncios novos',exact:true}).click();await page.getByText('Sincronizando anúncios novos de hoje',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Sincronizar anúncios',exact:true}).isDisabled(),true);
 while(!release)await page.waitForTimeout(25);await release();await page.getByText('3 anúncio(s) criado(s) hoje sincronizado(s).',{exact:true}).waitFor();assert.equal(todayCalls,1);assert.equal(fullCalls,0);assert.equal(await page.getByRole('button',{name:'Sincronizar anúncios novos',exact:true}).isEnabled(),true);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({todayActionVisible:true,selectedAccountPreserved:true,completeSyncStillAvailable:true,concurrentButtonsDisabled:true,onlyTodayEndpointCalled:true,noMarketplaceWrites:true,errors}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
