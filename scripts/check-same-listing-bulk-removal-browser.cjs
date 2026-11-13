const assert = require('node:assert/strict');
const {chromium} = require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());
  const page=await browser.newPage();const errors=[],sent=[];let failSecond=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','cmt0hm1ij0000v2usd4sd5q4h');},login.accessToken);
  await page.route('**/api/**',route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   if(path==='/api/listing-links/sku/preview')return route.fulfill({status:400,json:{message:'Escolha a variação Olist.',details:{code:'SKU_MANUAL_SELECTION_REQUIRED',rows:[10,20,30].map(id=>({mlb:'MLB1',variationId:String(id),color:'Cinza',size:'GG',missingInOlist:true})),options:[{sku:'58087.1',color:'Cinza',size:'M'}]}}});
   if(path.endsWith('/sku/missing-removal/prepare')){const input=req.postDataJSON();return route.fulfill({json:{id:'review-'+input.variationId,mlb:'MLB1',variationId:input.variationId,color:'Cinza',size:'GG',catalogSizes:['M'],message:'Excluir somente esta variação.'}});}
   const match=path.match(/\/missing-removal\/review-(\d+)\/confirm$/);
   if(match){const id=match[1];assert.equal(req.postDataJSON().previousReviewId,id==='10'?undefined:'review-'+(Number(id)-10));sent.push(id);return route.fulfill({json:failSecond&&id==='20'?{success:false,message:'Falha simulada.'}:{success:true,mlb:'MLB1',variationId:id}});}
   return req.method()==='GET'?route.continue():route.fulfill({json:{}});
  });
  await page.goto('http://localhost:4201/anuncios');const dialog=page.locator('app-sku-link-dialog');
  const open=async()=>{await page.getByRole('button',{name:'Vincular SKU',exact:true}).first().click();await dialog.getByLabel('SKU pai na Olist').fill('58087');await dialog.getByRole('button',{name:'Corrigir SKUs e vincular',exact:true}).click();await dialog.locator('.manual-row').nth(2).waitFor();};
  const prepare=async()=>{await dialog.getByRole('button',{name:'Excluir todas sem correspondente na Olist',exact:true}).click();await dialog.getByRole('heading',{name:'Confirmar exclusão de 3 oferta(s)',exact:true}).waitFor();};
  await open();await prepare();assert.deepEqual(sent,[]);
  await dialog.getByRole('button',{name:'Confirmar exclusão das 3 ofertas no Mercado Livre',exact:true}).click();
  await dialog.getByText('3 de 3 exclusão(ões) confirmada(s).',{exact:true}).waitFor();assert.deepEqual(sent,['10','20','30']);assert.equal(await dialog.locator('.manual-row').count(),0);
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();sent.length=0;failSecond=true;
  await open();await prepare();await dialog.getByRole('button',{name:'Confirmar exclusão das 3 ofertas no Mercado Livre',exact:true}).click();await dialog.getByText('Falha simulada.',{exact:true}).waitFor();assert.deepEqual(sent,['10','20']);assert.equal(await dialog.locator('.manual-row').count(),2);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({sameMlbBatch:true,verifiedContinuation:true,stopsOnFailure:true,noRealDeletion:true,errors}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
