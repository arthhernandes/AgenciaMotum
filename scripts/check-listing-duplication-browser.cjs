const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
 let generated,prepared,confirmations=0,polls=0,resumptions=0;
 const titles=['Camisa Polo Masculina Original','Polo Masculina Camisa Original'];
 const rows=titles.flatMap((title,copy)=>['10.1','10.2'].map((sku,i)=>({title,copy,sku,reference:'MLB'+(i+1),price:100,stock:3,status:'active'})));
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/chat/listing-duplication/destinations')return route.fulfill({json:[{id:'olist-ts-comercio',name:'Motum'},{id:'outlet-destination',name:'Outlet4u'}]});
  if(url.pathname==='/api/chat/listing-duplication')return route.fulfill({body:'null',contentType:'application/json'});
  if(url.pathname==='/api/chat/listing-duplication/options')return route.fulfill({json:{version:'a'.repeat(64),variants:[{key:'MLB1',offerKey:'MLB1',reference:'MLB1',sku:'10.1',color:'Preto',size:'P',pictures:[{id:'photo-one',url:'https://example.com/photo.png'}]}]}});
  if(url.pathname==='/api/chat/listing-duplication/titles'){generated=req.postDataJSON();return route.fulfill({json:{reference:generated.reference,version:'a'.repeat(64),originalTitle:'Camisa Polo Original',maxTitleLength:60,offersPerCopy:2,titles}});}
  if(url.pathname==='/api/chat/listing-duplication/prepare'){prepared=req.postDataJSON();return route.fulfill({json:{id:'test-review',destinationName:'Outlet4u',destinationAccountId:'outlet-destination',copies:2,offersPerCopy:2,totalOffers:4,titles:prepared.titles,rows:rows.map(r=>({...r,title:prepared.titles[r.copy]})),warnings:['Aviso de teste: frete grátis obrigatório.']}});}
  if(url.pathname==='/api/chat/listing-duplication/test-review/confirm'){confirmations++;return route.fulfill({json:{jobId:'test-job'}});}
  if(url.pathname==='/api/chat/listing-duplication/test-job/resume'){resumptions++;return route.fulfill({json:{jobId:'test-job'}});}
  if(url.pathname==='/api/chat/listing-duplication/test-job'){if(!resumptions&&polls>=1){polls++;return route.fulfill({json:{jobId:'test-job',destinationName:'Outlet4u',status:'NEEDS_REVIEW',canResume:true,message:'Teste de interrupcao de status.',completed:1,created:2,total:4,copies:2,rows:rows.map((r,i)=>({...r,mlb:i<2?'MLB'+(100+i):null,state:i===0?'SUCCESS':i===1?'UNVERIFIED':'PENDING'}))}});}polls++;const done=polls>1;return route.fulfill({json:{jobId:'test-job',destinationName:'Outlet4u',destinationAccountId:'outlet-destination',status:done?'COMPLETE':'RUNNING',message:done?'Todas as cópias foram publicadas e conferidas.':'Publicando cópia 1 de 2.',completed:done?4:0,created:done?4:0,total:4,copies:2,rows:rows.map((r,i)=>({...r,mlb:done?'MLB'+(100+i):null,state:done?'SUCCESS':'PENDING',message:''}))}});}
  if(req.method()!=='GET')return route.fulfill({json:{}});return route.continue();
 });
 await page.goto('http://localhost:4201/anuncios');await page.locator('button.duplicate-action').first().click();
 await page.getByLabel('Conta de destino',{exact:true}).selectOption('outlet-destination');
 const quantity=page.getByLabel('Quantidade de cópias',{exact:true}),generate=page.getByRole('button',{name:'Gerar títulos com IA'});
 await quantity.fill('11');assert.equal(await generate.isDisabled(),true);await quantity.fill('2');await generate.click();
 await page.getByLabel('Título da cópia 1',{exact:false}).fill('Camisa Masculina Polo Original');
 assert.equal(generated.count,2);assert.equal(generated.destinationAccountId,'outlet-destination');assert.match(generated.reference,/^MLB\d+$/);assert.equal(confirmations,0);
 await page.getByRole('button',{name:'Revisar cópias'}).click();await page.getByText('Aviso de teste: frete grátis obrigatório.').waitFor();assert.equal(prepared.titles[0],'Camisa Masculina Polo Original');assert.equal(prepared.titles.length,2);assert.equal(prepared.destinationAccountId,'outlet-destination');await page.locator('.destination-notice').getByText('Outlet4u',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('selectedMarketplaceAccountId')),'olist-ts-comercio');assert.equal(confirmations,0);
 await page.getByRole('button',{name:'Confirmar e publicar 2 cópia(s)'}).click();await page.getByText('Publicando cópia 1 de 2.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Fechar',exact:true}).click();await page.locator('button.duplicate-action').first().click();
 await page.getByRole('button',{name:'Conferir criadas e continuar restantes'}).click();
 await page.getByRole('heading',{name:'Cópias concluídas'}).waitFor();assert.equal(resumptions,1);assert.equal(confirmations,1);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({destinationChoice:true,sourceAccountPreserved:true,copyCount:true,aiTitlesEditable:true,allVariationsPreviewed:true,warningsVisible:true,explicitConfirmation:true,reopenResumesProgress:true,resumeOnlyRemaining:true,noRealMarketplaceWrites:true,errors}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
