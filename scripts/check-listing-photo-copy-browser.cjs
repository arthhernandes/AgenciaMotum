const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:1536,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://localhost:4201'});
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=8;c.height=8;const ctx=c.getContext('2d');ctx.fillStyle='blue';ctx.fillRect(0,0,8,8);return c.toDataURL().split(',')[1];});
  await page.route('**/api/listing-links/sku/photo/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')}));
  let clipboardUploads=0;
  await page.route('**/api/chat/listing-editor/photos/upload?**',async r=>{clipboardUploads++;await new Promise(resolve=>setTimeout(resolve,500));return r.fulfill({json:{id:'MLB1-PHOTO',url:'https://example.com/MLB1.jpg'}})});
  await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
  let prepared;const writes=[];
  await page.route('**/api/listings/grouped?**',route=>route.fulfill({json:{data:[1,2].map(n=>({id:'test'+n,itemId:'MLB'+n,title:'Produto '+n,price:100,status:'active',availableQuantity:1,soldQuantity:0,variants:[],children:[],skuStatus:'missing'})),pagination:{total:2,page:1,limit:50,pages:1}}}));
  for(const metric of ['prices','sales','visits'])await page.route('**/api/listings/'+metric+'?**',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/chat/listing-editor?**',route=>{const reference=new URL(route.request().url()).searchParams.get('reference');return route.fulfill({json:{reference,version:'a'.repeat(64),familyId:null,title:'Produto '+reference,account:'Motum',attributes:[],offers:[{reference,title:'Produto',sku:'10',price:100,stock:15,sold:2,status:'active',stockEditable:false,attributes:[],description:'Original',pictures:[{id:reference+'-PHOTO',url:'https://example.com/'+reference+'.jpg'}],variations:[{id:10,price:100,available_quantity:5,sold_quantity:0,attributes:[],attribute_combinations:[{id:'COLOR',value_name:'Preto'},{id:'SIZE',value_name:'P'}],picture_ids:[reference+'-PHOTO']}]}]}})});
  await page.route('**/api/chat/listing-editor/prepare?**',route=>{prepared=route.request().postDataJSON();return route.fulfill({json:{id:'preview',shared:[],affected:['MLB2'],offers:[]}})});
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/chat/'))writes.push(request.url());});
  await page.goto('http://localhost:4201/anuncios');await page.locator('button.details-action').first().click();await page.getByRole('button',{name:'Editar fotos de Preto',exact:true}).click();
  let picker=page.locator('app-listing-photo-picker');assert.equal(await picker.getByRole('button',{name:'Colar foto copiada',exact:true}).isDisabled(),true);
  await picker.getByRole('button',{name:'Copiar foto 1',exact:true}).click();await picker.getByText(/Imagem copiada!/).waitFor();
  assert.equal(await page.evaluate(async()=>{const items=await navigator.clipboard.read();return items.some(item=>item.types.includes('image/png'));}),true);
  await page.getByRole('button',{name:'Fechar detalhes',exact:true}).click();await picker.waitFor({state:'hidden'});
  await page.locator('button.details-action').nth(1).click();await page.getByRole('button',{name:'Editar fotos de Preto',exact:true}).click();
  picker=page.locator('app-listing-photo-picker');await picker.getByRole('button',{name:'Colar foto copiada',exact:true}).click();
  assert.deepEqual(await picker.locator('.photo-grid img').evaluateAll(imgs=>imgs.map(img=>img.src)),['https://example.com/MLB2.jpg','https://example.com/MLB1.jpg']);
  await picker.getByRole('button',{name:'Colar foto copiada',exact:true}).click();assert.equal(await picker.locator('.photo-grid article').count(),2);assert.match(await picker.locator('.photo-notice').innerText(),/já está/);
  assert.equal(writes.length,0);
  await picker.locator('.photo-paste-area').focus();await page.keyboard.press('Control+V');await picker.locator('.upload-progress').waitFor();await picker.locator('.upload-progress').waitFor({state:'hidden'});assert.equal(clipboardUploads,1);assert.equal(await picker.locator('.photo-grid article').count(),2);
  await page.getByRole('button',{name:'Revisar alterações',exact:true}).click();await page.getByRole('heading',{name:'Confira as alterações',exact:true}).waitFor();
  assert.deepEqual(prepared.offers[0].variationPictures,[{variationId:'10',pictures:['MLB2-PHOTO','MLB1-PHOTO']}]);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({copyBetweenListings:true,originalCoverPreserved:true,duplicateBlocked:true,reviewRequired:true,noMarketplaceWrites:true}));
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
