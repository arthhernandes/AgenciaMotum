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
 await group.getByRole('button',{name:'Editar fotos desta cor'}).click();assert.equal(await page.getByPlaceholder('https://...').count(),0);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+WQAAAAASUVORK5CYII=','base64');
 await group.locator('input[type=file]').setInputFiles([{name:'foto1.png',mimeType:'image/png',buffer:png},{name:'foto2.png',mimeType:'image/png',buffer:png}]);
 await group.getByText('2 foto(s) adicionada(s).',{exact:false}).waitFor();assert.equal(uploads,2);assert.equal(await group.locator('.photo-grid img').count(),2);
 await group.getByRole('button',{name:'Aplicar aos 2 an'}).click();await page.getByRole('button',{name:'Revisar altera'}).click();await page.getByRole('button',{name:'Voltar para editar'}).waitFor();
 assert.deepEqual(reviewed.offers.map(o=>o.reference),['MLB1','MLB2']);for(const offer of reviewed.offers)assert.deepEqual(offer.pictures,['1-MLB123_102026','2-MLB123_102026']);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({multipleFileUpload:true,multipartVerified:true,previews:true,onlySelectedColorChanged:true,reviewRequired:true,errors}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
