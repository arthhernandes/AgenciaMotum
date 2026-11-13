const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());
 const page=await browser.newPage();const errors=[];let selected;
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
 await page.route('**/api/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/chat/listing-variations')return route.fulfill({json:{title:'Camiseta Verde',reference:'MLB1',userProducts:false,price:100,sizeChart:{status:'NOT_APPLICABLE',supported:false},rows:['P','M','G','GG'].map((size,index)=>({sku:'10.'+(index+1),cor:'Verde',tamanho:size,quantidadePublicavel:5,available:index>=2,pendenciaModeracao:index===0?'forbidden':undefined,motivoModeracao:index===0?'Envie a NF-e para comprovar a originalidade.':undefined}))}});
  if(path==='/api/chat/listing-variations/prepare'){selected=req.postDataJSON().skus;return route.fulfill({json:{actions:[]}});}
  return req.method()==='GET'?route.continue():route.fulfill({json:{}});
 });
 await page.goto('http://localhost:4201/anuncios');await page.getByRole('button',{name:'Adicionar variações',exact:true}).first().click();
 const dialog=page.locator('app-add-variations-dialog');await dialog.getByLabel('Selecionar SKU 10.4',{exact:true}).waitFor();
 for(const sku of ['10.1','10.2','10.3','10.4'])assert.equal(await dialog.getByLabel('Selecionar SKU '+sku,{exact:true}).isChecked(),false);
 assert.equal(await dialog.getByLabel('Selecionar SKU 10.1',{exact:true}).isDisabled(),true);await dialog.getByText('Bloqueado pelo Mercado Livre',{exact:true}).waitFor();await dialog.getByText('Envie a NF-e para comprovar a originalidade.',{exact:true}).waitFor();
 assert.equal(await dialog.getByLabel('Selecionar SKU 10.3',{exact:true}).isEnabled(),true);
 assert.equal(await dialog.getByLabel('Selecionar SKU 10.4',{exact:true}).isEnabled(),true);
 await dialog.getByLabel('Selecionar SKU 10.3',{exact:true}).check();await dialog.getByRole('button',{name:'Preparar inclusão',exact:false}).click();
 await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chat/listing-variations/prepare').catch(()=>{});
 assert.deepEqual(selected,['10.3']);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({moderationReasonVisible:true,allInitiallyUnchecked:true,forbiddenOfferDisabled:true,onlyUserSelectionSent:true,noPublication:true,errors}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
