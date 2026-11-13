const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
 let prepared,confirmations=0;
 await page.route('**/api/**',route=>{const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path==='/api/chat/listing-editor'&&request.method()==='GET'){const reference=url.searchParams.get('reference');return route.fulfill({json:{reference,version:'a'.repeat(64),familyId:'family-test',title:'Produto de teste',account:'Motum',attributes:[],offers:[reference,'MLB2'].map((id,i)=>({reference:id,title:'Produto',sku:'10.'+i,price:100,stock:3,sold:2,status:'active',attributes:[],variations:[],pictures:[],description:i?'Descrição diferente':'Descrição atual\nSegunda linha'}))}});}
  if(path==='/api/chat/listing-editor/prepare'){prepared=request.postDataJSON();return route.fulfill({json:{id:'test-review',shared:[],affected:prepared.offers.map(o=>o.reference),offers:prepared.offers.map(o=>({mlb:o.reference,title:'Produto',fields:[{field:'Descrição completa',before:'Texto anterior',after:o.description}],notes:[]}))}});}
  if(path==='/api/chat/listing-editor/test-review/confirm'){confirmations++;return route.fulfill({json:{success:true,message:'Descrição conferida em teste.'}});}
  if(request.method()!=='GET')return route.fulfill({json:{}});return route.continue();
 });
 await page.goto('http://localhost:4201/anuncios');await page.locator('button.details-action').first().click();
 await page.locator('.description-text').getByText('Descrição atual',{exact:false}).waitFor();
 assert.ok(await page.evaluate(()=>document.querySelector('app-listing-variation-grid').getBoundingClientRect().top<document.querySelector('.description-section').getBoundingClientRect().top));await page.getByRole('button',{name:'Editar preços',exact:true}).click();await page.locator('.color-toggle').first().click();await page.getByLabel('Preço do SKU 10.0',{exact:true}).fill('129.90');const text='Descrição revisada\n\nComposição confirmada do produto.';
 await page.getByLabel('Descrição do anúncio',{exact:true}).fill(text);
 assert.equal(await page.getByLabel('Anúncio da descrição',{exact:true}).count(),0);
 assert.equal(await page.locator('app-listing-variation-grid .row-tools').count(),2);
 await page.getByRole('button',{name:'Revisar alterações',exact:true}).click();await page.getByRole('heading',{name:'Confira as alterações',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Variações e anúncios',exact:true}).count(),0);
 assert.equal(prepared.offers.length,2);assert.equal(prepared.offers[0].price,129.9);assert.equal(prepared.offers[1].price,undefined);assert.ok(prepared.offers.every(o=>o.description===text));assert.equal(confirmations,0);
 await page.getByRole('button',{name:'Confirmar alterações no Mercado Livre',exact:true}).click();await page.getByText('Descrição conferida em teste.',{exact:true}).waitFor();
 assert.equal(confirmations,1);assert.deepEqual(errors,[]);console.log(JSON.stringify({descriptionVisible:true,duplicateSectionRemoved:true,skuAndFiscalActionsAtTop:true,priceAboveDescription:true,topPriceEditing:true,multilineEditing:true,parentDescriptionAppliesToAll:true,beforeAfterReview:true,confirmationRequired:true,noRealMarketplaceWrites:true,errors}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
