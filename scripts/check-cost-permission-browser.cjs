const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
 let saved,costRequests=0;
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/users'&&req.method()==='POST'){saved=req.postDataJSON();return route.fulfill({json:{id:'test-user',...saved}});}
  if(path==='/api/products')return route.fulfill({json:{data:[{id:'test-product',sku:'5586',title:'Produto teste',stock:3,variants:[{id:'test-variant',sku:'5586.42',color:'Branco',size:'XXXG',stock:3,links:[]}],links:[],issues:[]}],pagination:{page:1,limit:50,total:1,pages:1}}});
  if(path==='/api/products/test-product/costs'){costRequests++;return route.fulfill({json:{rows:[{sku:'5586.42',cost:45.9,checkedAt:new Date().toISOString()}]}});}
  if(req.method()!=='GET')throw new Error('Unexpected write: '+path);return route.continue();
 });
 await page.goto('http://192.168.15.88:4201/usuarios',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Novo usuário',exact:true}).click();
 const permission=page.getByRole('checkbox',{name:'Visualizar Custos dos produtos',exact:true});assert.equal(await permission.isChecked(),false);await permission.check();
 await page.getByLabel('Nome',{exact:true}).fill('Teste custo');await page.getByLabel('E-mail',{exact:true}).fill('cost-test@example.com');await page.getByLabel('Senha inicial',{exact:false}).fill('safe-test-123');await page.getByRole('button',{name:'Criar usuário',exact:true}).click();await page.getByText('Usuário salvo.',{exact:true}).waitFor();assert.ok(saved.permissions.includes('costs.view'));
 await page.route('**/api/auth/me**',route=>route.fulfill({json:{id:'restricted',role:'CONSULTANT',permissions:['map.view']}}));
 await page.goto('http://192.168.15.88:4201/mapa',{waitUntil:'domcontentloaded'});await page.locator('tr.product-row').first().click();await page.locator('.link-panel').waitFor();assert.equal(await page.locator('.cost-toolbar').count(),0);assert.equal(await page.locator('.variant-cost').count(),0);assert.equal(costRequests,0);
 await page.route('**/api/auth/me**',route=>route.fulfill({json:{id:'restricted',role:'CONSULTANT',permissions:['map.view','costs.view']}}));
 await page.goto('http://192.168.15.88:4201/mapa',{waitUntil:'domcontentloaded'});await page.locator('tr.product-row').first().click();await page.locator('.variant-cost strong').waitFor();assert.match(await page.locator('.variant-cost strong').first().innerText(),/45[,.]90/);assert.equal(costRequests,1);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({separatePermission:true,disabledByDefault:true,selectedPermissionSent:true,hiddenWithoutPermission:true,noCostFetchWithoutPermission:true,visibleWithPermission:true,noRealUserOrProviderWrites:true,errors}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
