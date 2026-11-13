const assert=require('node:assert/strict');const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1536,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let calls=0,polls=0,release;
 const job={id:'new-products-test',source:'OLIST',type:'INCREMENTAL_SYNC',status:'RUNNING',createdAt:new Date().toISOString(),itemsProcessed:0,errorDetails:{scope:{createdFrom:'2026-11-10 00:00:00'},progress:{total:2,percent:0,message:'Consultando produtos criados hoje na Olist'}}};
 await page.addInitScript(t=>{localStorage.setItem('token',t);localStorage.setItem('selectedMarketplaceAccountId','cmt0hm1ij0000v2usd4sd5q4h');},login.accessToken);
 await page.route('**/api/**',route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname;
  if(path==='/api/olist/account')return route.fulfill({json:{connected:true,configured:true,sellerId:'outlet4u'}});
  if(path==='/api/marketplace-accounts')return route.fulfill({json:[]});
  if(path==='/api/sync/daily')return route.fulfill({json:null});
  if(path==='/api/sync/daily/reports'||path==='/api/sync/executions')return route.fulfill({json:[]});
  if(path==='/api/sync/olist/new-today'){calls++;assert.equal(url.searchParams.get('marketplaceAccountId'),'cmt0hm1ij0000v2usd4sd5q4h');return new Promise(resolve=>release=()=>route.fulfill({json:job}).then(resolve));}
  if(path==='/api/sync/executions/new-products-test'){polls++;return route.fulfill({json:polls===1?job:{...job,status:'SUCCESS',itemsProcessed:2,errorDetails:{...job.errorDetails,progress:{total:2,percent:100,message:'Sincronização dos produtos novos concluída'}}}});}
  if(req.method()!=='GET')throw Error('Unexpected write '+path);
  return route.continue();
 });
 await page.goto('http://localhost:4201/sincronizacoes');const button=page.getByRole('button',{name:'Sincronizar produtos novos',exact:true});await button.click();assert.equal(await button.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Sincronizar Olist',exact:true}).isDisabled(),true);await release();await page.getByText('Sincronização dos produtos novos concluída',{exact:true}).waitFor();assert.equal(calls,1);assert.deepEqual(errors,[]);console.log(JSON.stringify({newProductsButton:true,selectedAccount:true,progress:true,fullSyncPreserved:true,noRemoteWrites:true}));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
