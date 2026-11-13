const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());
  if(!login.accessToken)throw new Error('Local test login failed');
  await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
  if(!process.argv.includes('--live'))await page.route('**/api/operations/fiscal-templates?*',route=>route.fulfill({json:[]}));
  await page.goto('http://192.168.15.88:4201/modelos-fiscais');
  await page.getByRole('button',{name:'Novo modelo',exact:true}).click();
  for(let index=0;index<10;index++)await page.getByRole('button',{name:'Novo modelo',exact:true}).click();
  await page.getByLabel('Nome do modelo').fill('Teste local — não salvar');
  await page.getByLabel('Regime tributário').selectOption('normal');
  await page.getByLabel('ID da regra tributária',{exact:true}).waitFor();
  await page.getByLabel('Regime tributário').selectOption('simples');
  await page.getByLabel('CSOSN',{exact:true}).fill('102');
  await page.getByRole('button',{name:'Novo modelo',exact:true}).click();
  console.log(JSON.stringify({responsive:await page.evaluate(()=>true),nameReset:await page.getByLabel('Nome do modelo').inputValue(),errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
