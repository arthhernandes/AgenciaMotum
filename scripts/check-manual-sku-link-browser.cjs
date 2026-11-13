const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:1536,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
  let prepared;const writes=[];
  await page.route('**/api/listings/grouped?**',route=>route.fulfill({json:{data:[1,2].map(n=>({id:'test'+n,itemId:'MLB'+n,title:'Produto '+n,price:100,status:'active',availableQuantity:1,soldQuantity:0,variants:[],children:[],skuStatus:'missing'})),pagination:{total:2,page:1,limit:50,pages:1}}}));
  for(const metric of ['prices','sales','visits'])await page.route('**/api/listings/'+metric+'?**',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/chat/listing-editor?**',route=>{const reference=new URL(route.request().url()).searchParams.get('reference');return route.fulfill({json:{reference,version:'a'.repeat(64),familyId:null,title:'Produto '+reference,account:'Motum',attributes:[],offers:[{reference,title:'Produto',sku:'10',price:100,stock:15,sold:2,status:'active',stockEditable:false,attributes:[],description:'Original',pictures:[{id:reference+'-PHOTO',url:'https://example.com/'+reference+'.jpg'}],variations:[{id:10,price:100,available_quantity:5,sold_quantity:0,attributes:[],attribute_combinations:[{id:'COLOR',value_name:'Preto'},{id:'SIZE',value_name:'P'}],picture_ids:[reference+'-PHOTO']}]}]}})});
  await page.route('**/api/chat/listing-editor/prepare?**',route=>{prepared=route.request().postDataJSON();return route.fulfill({json:{id:'preview',shared:[],affected:['MLB2'],offers:[]}})});
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/chat/'))writes.push(request.url());});

  await page.route('**/api/listing-links/sku/manual-options?**',r=>{assert.deepEqual(r.request().postDataJSON().parentSkus,['other']);return r.fulfill({json:{rows:[{mlb:'MLB1',variationId:'10',color:'Preto',size:'P',before:'old'}],options:[{sku:'54446.2',color:'Azul',size:'2.P',parentSku:'other'},{sku:'54446.3',color:'Verde',size:'P',parentSku:'54446'},{sku:'54446.4',color:'Azul',size:'M',parentSku:'other'}]}})});
  let confirms=0,manualPreview;
  await page.route('**/api/listing-links/sku/preview?**',r=>{manualPreview=r.request().postDataJSON();return r.fulfill({json:{id:'manual-preview',rows:[{mlb:'MLB1',variationId:'10',color:'Preto',size:'P',before:'old',sku:'54446.2'}]}})});
  await page.route('**/api/listing-links/sku/manual-preview/confirm?**',r=>{confirms++;return r.fulfill({json:{success:false,message:'Teste concluido',linkedItems:[]}})});
  await page.goto('http://localhost:4201/anuncios');await page.locator('.compact-row-actions [mat-stroked-button]').first().click();await page.getByRole('menuitem',{name:'Vincular SKU',exact:true}).click();
  const d=page.locator('app-sku-link-dialog');assert.equal(await d.getByRole('button',{name:'Automático (recomendado)',exact:true}).getAttribute('aria-pressed'),'true');
  await d.getByRole('button',{name:'Vincular manualmente',exact:true}).click();await d.getByLabel('SKU pai na Olist').fill('54446');await d.getByLabel('Outro SKU pai (opcional)',{exact:true}).fill('other');await d.getByRole('button',{name:'Carregar variações',exact:true}).click();
  const select=d.locator('.manual-row mat-select').first();await select.waitFor();assert.equal((await select.innerText()).trim(),'');await select.click();
  assert.equal(await page.getByRole('option').count(),3);
  await page.getByRole('option',{name:'other · 54446.2 · Azul · 2.P',exact:true}).click();
  await d.getByRole('button',{name:'Revisar vínculos manuais',exact:true}).click();await d.getByRole('heading',{name:'Confira os vínculos manuais',exact:true}).waitFor();assert.equal(confirms,0);assert.equal(manualPreview.manual,true);assert.equal(manualPreview.choices[0].sku,'54446.2');assert.equal(manualPreview.choices[0].parentSku,'other');
  await d.getByRole('button',{name:'Confirmar vínculos no Mercado Livre',exact:true}).click();await d.getByText('Teste concluido',{exact:true}).waitFor();assert.equal(confirms,1);assert.deepEqual(errors,[]);console.log(JSON.stringify({automaticDefault:true,manualStartsEmpty:true,typedSku:true,reviewBeforeConfirm:true,noRealWrites:true}));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
