const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());
 const page=await browser.newPage();const errors=[];let selected,sentChart;let large=false,confirmations=0;
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
 await page.route('**/api/**',route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/chat/listing-variations')return route.fulfill({json:{title:'Camiseta Verde',reference:'MLB1',userProducts:false,price:100,sizeChart:large?{status:'SUPPORTED',supported:true}:{status:'NOT_APPLICABLE',supported:false},rows:large?Array.from({length:50},(_,index)=>({sku:'10.'+(index+1),cor:'Verde',tamanho:['P','M','G','GG','XXG','XXXG'][index%6],quantidadePublicavel:5,available:index>=2})):['P','M','G','GG'].map((size,index)=>({sku:'10.'+(index+1),cor:'Verde',tamanho:size,quantidadePublicavel:5,available:index>=2}))}});
  if(path==='/api/chat/size-charts')return route.fulfill({json:{currentChartId:'8319368',charts:[{id:'8319368',name:'Modelo atual',type:'SPECIFIC',compatible:true,sizes:['P','M','G','GG','XXG','XXXG'],rows:[]},{id:'44',name:'Escolhida',type:'SPECIFIC',compatible:true,sizes:['P','M','G','GG','XXG','XXXG'],rows:[]}]}});
  if(path==='/api/chat/listing-variations/prepare'){selected=req.postDataJSON().skus;sentChart=req.postDataJSON().sizeChartId;return route.fulfill({json:{actions:large?[{id:'all-selected',preview:[],confirmationLabel:'Confirmar inclusao'}]:[]}});}
  if(path==='/api/chat/actions/all-selected/confirm'){confirmations++;return route.fulfill({json:{success:true,message:'48 selecionadas incluidas em 3 lotes.'}});}
  return req.method()==='GET'?route.continue():route.fulfill({json:{}});
 });
 await page.goto('http://localhost:4201/anuncios');await page.locator('.row-actions button[aria-haspopup="menu"]').first().click();await page.locator('.cdk-overlay-container .add-variants-action').click();
 const dialog=page.locator('app-add-variations-dialog');await dialog.getByLabel('Selecionar SKU 10.4',{exact:true}).waitFor();
 for(const sku of ['10.1','10.2','10.3','10.4'])assert.equal(await dialog.getByLabel('Selecionar SKU '+sku,{exact:true}).isChecked(),false);
 assert.equal(await dialog.getByLabel('Selecionar SKU 10.1',{exact:true}).isDisabled(),true);
 assert.equal(await dialog.getByLabel('Selecionar SKU 10.3',{exact:true}).isEnabled(),true);
 assert.equal(await dialog.getByLabel('Selecionar SKU 10.4',{exact:true}).isEnabled(),true);
 await dialog.getByLabel('Selecionar SKU 10.3',{exact:true}).check();const prepared=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chat/listing-variations/prepare');await dialog.getByRole('button',{name:'Preparar inclusão',exact:false}).click();
 await prepared;
 assert.deepEqual(selected,['10.3']);assert.deepEqual(errors,[]);
 await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();large=true;
 await page.locator('.row-actions button[aria-haspopup="menu"]').first().click();await page.locator('.cdk-overlay-container .add-variants-action').click();
 await dialog.getByLabel('Selecionar SKU 10.50',{exact:true}).waitFor();await dialog.getByLabel('Selecionar SKU 10.3',{exact:true}).check();await dialog.locator('.size-chart-header button').click();await dialog.locator('.selected-chart h4').filter({hasText:'Modelo atual'}).waitFor();await dialog.locator('.chart-selector mat-select').click();await page.getByRole('option',{name:/Escolhida/}).click();await dialog.getByRole('button',{name:'Todas as disponíveis',exact:false}).click();
 assert.equal(await dialog.locator('input[type=checkbox]:checked').count(),48);
 const allPrepared=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chat/listing-variations/prepare');
 await dialog.getByRole('button',{name:'Preparar inclusão',exact:false}).click();await allPrepared;
 assert.equal(selected.length,48);assert.equal(sentChart,'44');assert.equal(await dialog.locator('.selected-chart h4').count(),0);assert.match(await dialog.innerText(),/3 lotes/);
 await dialog.getByRole('button',{name:'Confirmar inclusao',exact:true}).click();await dialog.getByText('48 selecionadas incluidas em 3 lotes.',{exact:true}).waitFor();
 assert.equal(confirmations,1);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({sameColorMissingSizesEnabled:true,allInitiallyUnchecked:true,existingCombinationsProtected:true,onlyUserSelectionSent:true,all48SelectedInOnePreview:true,oneConfirmation:true,chosenChartPreservedAcrossSelectAll:true,noPublication:true,errors}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
