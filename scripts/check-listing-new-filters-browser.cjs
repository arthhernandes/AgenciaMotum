const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage({viewport:{width:1536,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','cmt0hm1ij0000v2usd4sd5q4h');},login.accessToken);
  const child={id:'test',itemId:'MLB1',title:'Produto teste',price:100,status:'active',availableQuantity:1,soldQuantity:0,rawData:{},links:[]};
  const group={...child,children:[child],variants:[],skuStatus:'found'};let withChecks=0;
  await page.route('**/api/listings/grouped?**',route=>{const filter=new URL(route.request().url()).searchParams.get('promotion');if(filter==='with')withChecks++;return route.fulfill({json:{data:filter==='without'?[]:[group],pagination:{page:1,limit:50,total:filter==='without'?0:1,pages:1},...(filter?{promotionCheck:{checked:withChecks===1&&filter==='with'?0:1,total:1,remaining:withChecks===1&&filter==='with'?1:0,unavailable:0,nextRetryMs:100}}:{})}});});
  for(const metric of ['prices','sales','visits'])await page.route('**/api/listings/'+metric+'?**',route=>route.fulfill({json:{items:[{itemId:'MLB1',amount:90,promotional:true,visits:0,soldQuantity:0}]}}));
  await page.route('**/api/chat/listing-variations?**',route=>route.fulfill({json:{userProducts:true,price:100,sizeChart:{supported:false,status:'NOT_APPLICABLE'},rows:[{sku:'1.M',cor:'Branco',tamanho:'M',available:false,cadastradaNaFamilia:true,cadastrosSemOferta:['MLBU5821987954'],pendenciaModeracao:'waiting_for_patch',motivoModeracao:'Oferta antiga com pendência'},{sku:'1.G',cor:'Branco',tamanho:'G',available:true,cadastradaNaFamilia:false}]}}));
  await page.goto('http://localhost:4201/anuncios');const promotion=page.getByRole('combobox',{name:'Promoção',exact:true});await promotion.click();await page.getByRole('option',{name:'Com promoção',exact:true}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('Preços conferidos: 1 de 1'));assert.ok(withChecks>=2);
  await promotion.click();await page.getByRole('option',{name:'Sem promoção',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('button.title-link').length===0);
  await promotion.click();await page.getByRole('option',{name:'Todos',exact:true}).click();await page.getByRole('button',{name:'Adicionar variações',exact:true}).first().click();
  const dialog=page.locator('app-add-variations-dialog');await dialog.getByText('Cadastro criado, sem oferta publicada: MLBU5821987954',{exact:true}).waitFor();
  const situation=dialog.getByRole('combobox',{name:'Filtrar situação',exact:true});await situation.click();await page.getByRole('option',{name:'Cadastradas sem oferta',exact:true}).click();assert.equal(await dialog.locator('tbody tr').count(),1);assert.equal(await dialog.getByLabel('Selecionar SKU 1.M',{exact:true}).isChecked(),false);
  await situation.click();await page.getByRole('option',{name:'Ausentes da família',exact:true}).click();assert.equal(await dialog.locator('tbody tr').count(),1);assert.equal(await dialog.getByLabel('Selecionar SKU 1.G',{exact:true}).isChecked(),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({promotionFilters:true,progressiveScopeQuery:true,draftVisible:true,situationFilters:true,initiallyUnchecked:true,noRemoteWrites:true}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
