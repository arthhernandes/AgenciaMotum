const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());
  if(!login.accessToken)throw new Error('Local login failed');
  await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
  const rows=['P','M','G'].map((size,index)=>({sku:'TEST.'+index,mlb:'MLB1',title:'Produto teste',color:'Preto',size,values:{cost:String(10+index),ncm:'00000000',ean:'ean-'+index,origin_detail:String(index)},sources:{},current:{}}));
  let reviewed;
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/api/operations/fiscal-templates')return route.fulfill({json:[{id:'template',name:'Modelo teste',regime:'simples',values:{ncm:'61091000',origin_type:'reseller',measurement_unit:'UN',csosn:'102',origin_detail:'',cost:'999'}}]});
   if(url.pathname==='/api/chat/listing-fiscal')return route.fulfill({json:{actionId:'test-action',draft:{regime:'',rows}}});
   if(url.pathname==='/api/chat/actions/test-action/fiscal'){reviewed=request.postDataJSON();return route.fulfill({json:{actions:[{id:'test-review',preview:[]}]}});}
   if(request.method()!=='GET')return route.fulfill({json:{}});
   return route.continue();
  });
  await page.goto('http://192.168.15.88:4201/anuncios');
  await page.getByRole('button',{name:'Dados fiscais',exact:true}).first().click();
  await page.locator('app-listing-fiscal-dialog').waitFor();
  await page.getByLabel('Modelo fiscal',{exact:true}).selectOption('template');
  await page.getByRole('button',{name:'Aplicar modelo em todas',exact:true}).click();
  const dialog=page.locator('app-listing-fiscal-dialog');
  for(let i=0;i<3;i++){
   assert.equal(await dialog.getByLabel('NCM do SKU TEST.'+i,{exact:true}).inputValue(),'61091000');
   assert.equal(await dialog.getByLabel('Custo (R$) do SKU TEST.'+i,{exact:true}).inputValue(),String(10+i));
  }
  await page.getByLabel('Custo para todas (R$)',{exact:true}).fill('-1');
  assert.equal(await page.getByRole('button',{name:'Aplicar custo em todas',exact:true}).isDisabled(),true);
  await page.getByLabel('Custo para todas (R$)',{exact:true}).fill('45.90');
  await page.getByRole('button',{name:'Aplicar custo em todas',exact:true}).click();
  await page.getByRole('button',{name:'Revisar alterações',exact:true}).click();
  await page.getByRole('button',{name:'Voltar para editar',exact:true}).waitFor();
  assert.equal(reviewed.rows.length,3);
  reviewed.rows.forEach((row,i)=>{assert.equal(row.values.cost,'45.90');assert.equal(row.values.ncm,'61091000');assert.equal(row.values.origin_detail,String(i));assert.equal(row.values.ean,'ean-'+i);});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({allVariationsUpdated:true,modelDoesNotOverwriteCost:true,unrelatedFieldsPreserved:true,invalidCostBlocked:true,reviewPayloadVerified:true,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
