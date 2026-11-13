const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 const accounts=await fetch('http://localhost:3001/api/marketplace-accounts/business',{headers:{Authorization:'Bearer '+login.accessToken}}).then(r=>r.json());const account=accounts[0];
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:1536,height:1000}});page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({token,id})=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId',id);},{token:login.accessToken,id:account.id});
  const listing=(id)=>({id,itemId:'MLB'+id,title:'Jaqueta Puffer',price:100,status:'active',skuStatus:'found',foundSkuCount:1,missingSkuCount:0,absentSkuCount:0,availableQuantity:1,soldQuantity:1,rawData:{},links:[],marketplaceAccountId:account.id,marketplaceAccount:{name:'Teste'}});
  const child=listing('1'),other=listing('3');
  const incomplete={...child,hasFull:true,isFull:false,fullCount:1,fullTotal:2,id:'family1',title:'Jaqueta com pendência',itemId:'2 MLBs',children:[child,listing('2')],fiscalStatus:'incomplete',fiscalIncompleteCount:1,fiscalReasons:['Custo fiscal não informado'],variants:[{id:'1',isFull:true,sku:'59327.26',itemId:'MLB1',status:'active',price:100,fiscalStatus:'incomplete',fiscalReasons:['Custo fiscal não informado'],listingData:child},{id:'2',sku:'59327.1',itemId:'MLB2',status:'active',price:100,fiscalStatus:'complete',fiscalReasons:[],listingData:child}]};
  const complete={...other,id:'family2',title:'Produto com cadastro completo',children:[other],fiscalStatus:'complete',variants:[{sku:'100.1',itemId:'MLB3',listingData:other}]};
  let checks=0;
  await page.route('**/api/listings/grouped?**',route=>{const url=new URL(route.request().url()),filter=url.searchParams.get('fiscalStatus');let data=[incomplete,complete],fiscalCheck;if(url.searchParams.get('full')==='true')data=[incomplete];if(url.searchParams.get('full')==='false')data=[complete];
   if(filter==='incomplete'){checks++;if(checks===1)return route.fulfill({status:503,json:{message:'Temporary provider failure'}});data=checks===2?[]:[incomplete];fiscalCheck=checks===2?{checked:1,total:2,remaining:1,unavailable:0}:{checked:2,total:2,remaining:0,unavailable:0};}
   if(filter==='complete'){data=[complete];fiscalCheck={checked:2,total:2,remaining:0,unavailable:0};}
   if(filter==='cost_above_olist'){data=[{...incomplete,costAboveOlistCount:1,variants:incomplete.variants.map((variant,index)=>({...variant,costAboveOlist:index===0,fiscalCost:120,olistCost:100}))}];fiscalCheck={checked:2,total:2,remaining:0,unavailable:0};}
   if(filter==='unknown'){data=[];fiscalCheck={checked:2,total:2,remaining:0,unavailable:0};}
   return route.fulfill({json:{data,pagination:{page:1,limit:50,total:data.length,pages:1},fiscalCheck}});
  });
  await page.route('**/api/listings/visits?**',route=>route.fulfill({json:{items:route.request().postDataJSON().ids.map(itemId=>({itemId,visits:0}))}}));
  await page.goto('http://localhost:4201/anuncios',{waitUntil:'domcontentloaded'});await page.locator('.full-badge').first().waitFor();assert.match(await page.locator('.full-badge').first().innerText(),/Full em parte/);const logistics=page.getByRole('combobox',{name:'Logística',exact:true});await logistics.click();await page.getByRole('option',{name:'Com Full',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('button.title-link').length===1);assert.match(await page.locator('button.title-link').innerText(),/pendência/);await logistics.click();await page.getByRole('option',{name:'Sem Full',exact:true}).click();await page.getByText('Produto com cadastro completo',{exact:true}).waitFor();assert.equal(await page.locator('.full-badge').count(),0);await logistics.click();await page.getByRole('option',{name:'Todos',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('button.title-link').length===2);const filter=page.getByRole('combobox',{name:'Dados fiscais',exact:true});await filter.click();assert.equal(await page.getByRole('option',{name:'Não verificados',exact:true}).count(),0);await page.getByRole('option',{name:'Incompletos',exact:true}).click();
  await page.getByText('Conferência fiscal concluída: 2 SKUs',{exact:true}).waitFor();assert.ok(checks>=3);assert.equal(await page.locator('button.title-link').count(),1);assert.match(await page.locator('button.title-link').innerText(),/pendência/);
  await page.locator('.variant-button').click();await page.locator('.variant-panel').getByText('Custo fiscal não informado',{exact:true}).waitFor();assert.equal(await page.locator('.variant-panel .full-badge').count(),1);
  await filter.click();await page.getByRole('option',{name:'Completos',exact:true}).click();await page.getByText('Produto com cadastro completo',{exact:true}).waitFor();assert.equal(await page.locator('button.title-link').count(),1);
  await filter.click();await page.getByRole('option',{name:'Preço de custo acima do da Olist',exact:true}).click();await page.getByText('1 variação(ões) com custo acima da Olist',{exact:true}).waitFor();
  await page.locator('.variant-button').click();assert.match(await page.locator('.variant-panel').innerText(),/Custo ML:\s*R\$\s*120[.,]00\s*·\s*Olist:\s*R\$\s*100[.,]00/);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({fiscalFilter:true,progressiveVerification:true,anyIncompleteVariantIncludesFamily:true,reasonVisible:true,completeFilter:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
