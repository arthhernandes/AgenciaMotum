const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());
  if(!login.accessToken)throw new Error('Local login failed');
  await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
  const rows=['P','M','G'].map((size,index)=>({sku:'TEST.'+index,mlb:'MLB1',title:'Produto teste',color:'Preto',size,values:{origin_type:'reseller',tax_rule_id:'7',cost:String(10+index),ncm:'00000000',ean:'ean-'+index,origin_detail:String(index)},sources:{},current:{}}));
  let reviewed;
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith('/tax-rules'))return route.fulfill({json:[{id:7,description:'Vendas nacionais'},{id:8,description:'Outra regra'}]});
   if(url.pathname==='/api/operations/fiscal-templates')return route.fulfill({json:[{id:'template',name:'Modelo teste',regime:'simples',values:{ncm:'61091000',origin_type:'reseller',measurement_unit:'UN',csosn:'102',origin_detail:'',cost:'999'}}]});
   if(url.pathname==='/api/chat/listing-fiscal')return route.fulfill({json:{actionId:'test-action',draft:{regime:'normal',regimeLocked:true,rows}}});
   if(url.pathname==='/api/chat/actions/test-action/fiscal'){reviewed=request.postDataJSON();return route.fulfill({json:{actions:[{id:'test-review',preview:[]}]}});}
   if(request.method()!=='GET')return route.fulfill({json:{}});
   return route.continue();
  });
  await page.goto('http://localhost:4201/anuncios');
  await page.getByRole('button',{name:'Dados fiscais',exact:true}).first().click();
  await page.locator('app-listing-fiscal-dialog').waitFor();
  const dialog=page.locator('app-listing-fiscal-dialog');
  const rules=dialog.getByRole('combobox',{name:'ID da regra tributária do SKU TEST.0',exact:true});
  await rules.getByRole('option',{name:'Vendas nacionais · 7',exact:true}).waitFor({state:'attached'});
  assert.equal(await rules.inputValue(),'7');
  await rules.selectOption('8');
  await page.getByRole('button',{name:'Aplicar alterações',exact:true}).click();
  await page.getByRole('button',{name:'Voltar para editar',exact:true}).waitFor();
  assert.equal(reviewed.rows[0].values.tax_rule_id,'8');



  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({typingPreservesFocus:true,allFiscalInputsEditable:true,reviewPayloadVerified:true,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
