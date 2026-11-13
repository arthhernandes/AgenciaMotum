const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 const headers={Authorization:'Bearer '+login.accessToken};
 const accounts=await fetch('http://localhost:3001/api/marketplace-accounts/business',{headers}).then(r=>r.json());
 const account=accounts.find(a=>a.id==='olist-ts-comercio')??accounts[0];assert.ok(account);
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(60000);const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({token,account})=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId',account);},{token:login.accessToken,account:account.id});
  page.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/')&&req.method()!=='GET')errors.push('Unexpected write: '+req.url());});
  await page.goto('http://192.168.15.88:4201/relatorios',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Mais vendidos por SKU pai',exact:true}).waitFor();
  assert.ok(await page.locator('tbody tr').count()>0);
  assert.equal(await page.getByRole('link',{name:/Relatórios/}).count(),1);
  assert.equal(await page.getByRole('link',{name:/Auditoria de anúncios|Central de pendências/}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Sincroniza\u00e7\u00f5es',exact:true}).count(),0);
  await page.getByRole('textbox',{name:'Buscar anúncio',exact:true}).fill('never-matching-zzzzz');await page.getByText('Nenhum anúncio encontrado.',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(700);
  assert.equal(await page.locator('app-reports').evaluate(el=>el.scrollWidth>el.clientWidth),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({account:account.displayName,realData:true,listingsOnly:true,search:true,mobileFits:true,noMarketplaceWrites:true,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
