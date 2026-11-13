const assert=require('node:assert/strict');const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const l=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1536,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let previews=0,removals=0;
 await page.addInitScript(t=>{localStorage.setItem('token',t);localStorage.setItem('selectedMarketplaceAccountId','cmt0hm1ij0000v2usd4sd5q4h');},l.accessToken);
 await page.route('**/api/**',r=>{const req=r.request(),path=new URL(req.url()).pathname;
  if(path==='/api/listings/grouped')return r.fulfill({json:{data:[{id:'listing',itemId:'MLB1',title:'Teste',status:'active',price:100,variants:[],children:[],skuStatus:'missing'}],pagination:{total:1,page:1,limit:50}}});
  if(['/api/listings/prices','/api/listings/sales','/api/listings/visits'].includes(path))return r.fulfill({json:{items:[]}});
  if(path==='/api/listing-links/sku/preview'){
   previews++;if(previews===1)return r.fulfill({status:400,json:{message:'Selecione a variação',details:{code:'SKU_MANUAL_SELECTION_REQUIRED',rows:[{mlb:'MLB1',variationId:'',color:'Branco',size:'G',missingInOlist:true}],options:[]}}});
   const body=req.postDataJSON();assert.deepEqual(body.choices,[]);assert.deepEqual(body.skipped,[{mlb:'MLB1',variationId:''}]);return r.fulfill({json:{id:'skip-review'}});
  }
  if(path==='/api/listing-links/sku/skip-review/confirm')return r.fulfill({json:{success:true,linked:0,skipped:1,linkedItems:[],message:'Oferta mantida sem novo vínculo. Nenhuma alteração enviada.'}});
  if(path.includes('missing-removal')){removals++;throw Error('Unexpected deletion request');}
  if(req.method()!=='GET')throw Error('Unexpected write '+path);return r.continue();
 });
 await page.goto('http://localhost:4201/anuncios');await page.locator('.compact-row-actions [mat-stroked-button]').first().click();await page.getByRole('menuitem',{name:'Vincular SKU',exact:true}).click();const d=page.locator('app-sku-link-dialog');await d.getByLabel('SKU pai na Olist').fill('KITTEST');await d.getByRole('button',{name:'Corrigir SKUs e vincular',exact:true}).click();await d.locator('.manual-row mat-select').click();await page.getByRole('option',{name:'Deixar sem vincular (manter oferta)',exact:true}).click();assert.equal(await d.locator('.missing-row-actions').count(),0);assert.equal(await d.locator('.remove-all-toolbar').count(),0);await d.getByRole('button',{name:'Corrigir SKUs e vincular',exact:true}).click();await d.getByText('Oferta mantida sem novo vínculo. Nenhuma alteração enviada.',{exact:true}).waitFor();assert.equal(removals,0);assert.deepEqual(errors,[]);console.log(JSON.stringify({skipVisibleWithoutCompatibleSize:true,removalActionsHidden:true,continueLinking:true,noDeletionRequests:true}));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
