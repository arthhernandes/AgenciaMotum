const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
 const offers=['P','G','M'].map((size,i)=>({reference:'MLB'+(i+1),title:'Produto teste '+size,price:100,stock:2,status:'active',attributes:[{id:'COLOR',value_name:i===2?'Branco':'Azul'},{id:'SIZE',value_name:size}],pictures:[],variations:[]}));
 let uploads=0,reviewed;
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/chat/listing-editor')return route.fulfill({json:{title:'Produto teste',version:'a'.repeat(64),familyId:'1',account:'Teste',attributes:[],offers}});
  if(url.pathname==='/api/chat/listing-editor/photos/upload'){assert.match(req.headers()['content-type'],/multipart\/form-data; boundary=/);assert.ok(req.postDataBuffer().includes(Buffer.from('name="file"')));assert.ok(req.postDataBuffer().includes(Buffer.from('MLB1')));uploads++;return route.fulfill({json:{id:uploads+'-MLB123_102026',url:'https://http2.mlstatic.com/mock.jpg'}});}
  if(url.pathname==='/api/chat/listing-editor/prepare'){reviewed=req.postDataJSON();return route.fulfill({json:{id:'review',shared:[],offers:[],affected:reviewed.offers.map(o=>o.reference)}});}
  if(req.method()!=='GET')return route.fulfill({json:{}});return route.continue();
 });
 await page.goto('http://192.168.15.88:4201/anuncios');await page.locator('button.details-action').first().click();
 const group=page.locator('details.color-group').filter({has:page.locator('summary').filter({hasText:'Azul'})}).first();await group.locator('summary').click();
 await group.getByRole('button',{name:'Editar pre\u00e7o e status desta cor'}).click();
 const status=group.getByLabel('Status desta cor',{exact:true});const applyStatus=group.getByRole('button',{name:'Aplicar status a todos os tamanhos desta cor',exact:true});
 assert.equal(await applyStatus.isDisabled(),true);
 const statuses=()=>page.locator('.offers article .offer-fields select').evaluateAll(inputs=>inputs.map(input=>input.value));
 await status.selectOption('paused');await applyStatus.click();assert.deepEqual(await statuses(),['paused','paused','active']);
 await page.getByLabel('Status de todas as cores',{exact:true}).selectOption('paused');await page.getByRole('button',{name:'Aplicar status a todas as cores',exact:true}).click();assert.deepEqual(await statuses(),['paused','paused','paused']);
 const colorPrice=group.getByLabel('Pre\u00e7o desta cor (R$)',{exact:true});const applyColor=group.getByRole('button',{name:'Aplicar a todos os tamanhos desta cor'});
 await colorPrice.fill('-1');assert.equal(await applyColor.isDisabled(),true);
 await colorPrice.fill('12.345');assert.equal(await applyColor.isDisabled(),true);
 await colorPrice.fill('150.50');await applyColor.click();
 const prices=()=>page.locator('.offers article .offer-fields label:first-child input').evaluateAll(inputs=>inputs.map(input=>input.value));
 assert.deepEqual(await prices(),['150.5','150.5','100']);
 await page.getByLabel('Pre\u00e7o de todas as cores (R$)',{exact:true}).fill('199.99');
 await page.getByRole('button',{name:'Aplicar a todas as cores',exact:true}).click();assert.deepEqual(await prices(),['199.99','199.99','199.99']);
 const white=page.locator('details.color-group').filter({has:page.locator('summary').filter({hasText:'Branco'})}).first();await white.locator('summary').click();await white.locator('.offer-fields label:first-child input').fill('179.99');await white.locator('.offer-fields select').selectOption('active');
 await page.getByRole('button',{name:'Revisar altera'}).click();await page.getByRole('button',{name:'Voltar para editar'}).waitFor();
 assert.deepEqual(reviewed.offers.map(o=>({reference:o.reference,price:o.price})),[{reference:'MLB1',price:199.99},{reference:'MLB2',price:199.99},{reference:'MLB3',price:179.99}]);
 assert.deepEqual(reviewed.offers.map(o=>o.status),['paused','paused',undefined]);reviewed.offers.forEach((o,i)=>assert.deepEqual(Object.keys(o).sort(),i<2?['price','reference','status']:['price','reference']));
 await page.getByRole('button',{name:'Voltar para editar'}).click();await page.getByRole('button',{name:'Descartar edi\u00e7\u00e3o'}).click();assert.deepEqual(await prices(),['100','100','100']);assert.deepEqual(await statuses(),['active','active','active']);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({colorScope:true,allColorsScope:true,invalidValuesBlocked:true,individualOverride:true,priceAndStatusIndependent:true,colorStatusScope:true,allColorsStatusScope:true,reviewRequired:true,discardRestoresValues:true,errors}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
