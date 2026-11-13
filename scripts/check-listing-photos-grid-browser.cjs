const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
 const ids=[1,2,3,4].map(n=>n+'-MLB123_012026');let prepared,confirmations=0;
 await page.route('**/api/**',route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(path==='/api/chat/listing-editor'&&req.method()==='GET'){const reference=url.searchParams.get('reference');return route.fulfill({json:{reference,version:'a'.repeat(64),familyId:null,title:'Produto com variações',account:'Motum',attributes:[],offers:[{reference,title:'Produto',sku:'10',price:100,stock:15,sold:2,status:'active',stockEditable:false,attributes:[],description:'Descrição original',pictures:ids.slice(0,3).map(id=>({id,url:'https://example.com/'+id+'.jpg'})),variations:[['Preto','P'],['Preto','G'],['Branco','M']].map(([color,size],i)=>({id:10+i,price:100,available_quantity:5,sold_quantity:0,attributes:[{id:'SELLER_SKU',value_name:'10.'+i}],attribute_combinations:[{id:'COLOR',value_name:color},{id:'SIZE',value_name:size}],picture_ids:i<2?ids.slice(0,2):[ids[2]]}))}]}});}
  if(path==='/api/chat/listing-editor/photos/upload')return new Promise(resolve=>setTimeout(resolve,900)).then(()=>route.fulfill({json:{id:ids[3],url:'https://example.com/uploaded.png'}}));
  if(path==='/api/chat/listing-editor/prepare'){prepared=req.postDataJSON();return route.fulfill({json:{id:'test-review',shared:[],affected:prepared.offers.map(o=>o.reference),offers:[{mlb:prepared.reference,title:'Produto',fields:[{field:'Fotos da cor preta',before:'Originais',after:'Capa e detalhe revisados'}],notes:[]}]}});}
  if(path.endsWith('/test-review/confirm')){confirmations++;return route.fulfill({json:{success:true,message:'Fotos conferidas em teste.'}});}
  if(req.method()!=='GET')return route.fulfill({json:{}});return route.continue();
 });
 await page.goto('http://localhost:4201/anuncios');await page.locator('button.details-action').first().click();
 const toggle=page.getByRole('button',{name:'Expandir cor Preto',exact:true});await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.click();const collapse=page.getByRole('button',{name:'Recolher cor Preto',exact:true});assert.equal(await collapse.getAttribute('aria-expanded'),'true');await collapse.click();assert.equal(await page.getByRole('button',{name:'Expandir cor Preto',exact:true}).getAttribute('aria-expanded'),'false');
 await page.getByRole('button',{name:'Editar fotos de Preto',exact:true}).click();const editor=page.locator('.color-photo-editor');await editor.waitFor();
 const originalPictures=await editor.locator('.photo-grid img').evaluateAll(images=>images.map(img=>img.src));
 await editor.getByRole('button',{name:'Ampliar foto 1',exact:true}).click();
 const preview=page.locator('app-listing-photo-preview');await preview.waitFor();
 assert.equal(await preview.getByRole('button',{name:'Foto anterior',exact:true}).isDisabled(),true);
 await preview.getByRole('button',{name:'Próxima foto',exact:true}).click();
 assert.equal(await preview.getByRole('heading').innerText(),'Foto 2 de 2');
 await page.keyboard.press('ArrowLeft');assert.equal(await preview.getByRole('heading').innerText(),'Foto 1 de 2');
 await page.keyboard.press('Escape');await preview.waitFor({state:'hidden'});
 assert.deepEqual(await editor.locator('.photo-grid img').evaluateAll(images=>images.map(img=>img.src)),originalPictures);
 await editor.getByRole('button',{name:'Ampliar foto 2',exact:true}).click();await preview.waitFor();
 await preview.getByRole('button',{name:'Fechar foto ampliada',exact:true}).click();await preview.waitFor({state:'hidden'});
 assert.equal(await editor.isVisible(),true);
 await editor.getByRole('button',{name:'Mover foto para antes',exact:true}).nth(1).click();await editor.getByRole('button',{name:'Remover foto',exact:true}).last().click();
 await editor.getByLabel('Adicionar fotos de Preto',{exact:true}).setInputFiles({name:'preto.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=','base64')});
 await editor.locator('.upload-progress').waitFor();
 assert.match(await editor.locator('.upload-progress').innerText(),/foto 1 de 1: preto.png/);
 assert.equal(await editor.getByLabel('Adicionar fotos de Preto',{exact:true}).isDisabled(),true);
 await editor.locator('.photo-grid article').nth(1).waitFor();await editor.locator('.upload-progress').waitFor({state:'hidden'});
 assert.equal(await editor.getByLabel('Adicionar fotos de Preto',{exact:true}).isDisabled(),false);
 await page.getByRole('button',{name:'Revisar alterações',exact:true}).click();await page.getByRole('heading',{name:'Confira as alterações',exact:true}).waitFor();
 assert.deepEqual(prepared.offers[0].variationPictures,[{variationId:'10',pictures:[ids[1],ids[3]]},{variationId:'11',pictures:[ids[1],ids[3]]}]);assert.deepEqual(prepared.offers[0].pictures,[ids[1],ids[3],ids[2]]);assert.equal(prepared.offers[0].price,undefined);assert.equal(confirmations,0);assert.equal(await page.locator('.management-tools .color-photos').count(),0);
 await page.getByRole('button',{name:'Confirmar alterações no Mercado Livre',exact:true}).click();await page.getByText('Fotos conferidas em teste.',{exact:true}).waitFor();assert.equal(confirmations,1);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({photoEditorAtTop:true,colorExpandCollapse:true,uploadRemoveReorder:true,blackSizesOnly:true,whitePhotosPreserved:true,pricesUnchanged:true,reviewAndConfirmation:true,noRealMarketplaceWrites:true,errors}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
