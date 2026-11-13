const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Servidor/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/playwright/driver/package');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());assert.ok(login.accessToken);
 const headers={Authorization:'Bearer '+login.accessToken};const response=await fetch('http://localhost:3001/api/users',{headers});assert.equal(response.status,200);const users=await response.json();assert.ok(users.length);assert.ok(users.every(u=>!('passwordHash' in u)));
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);
 await page.addInitScript(token=>{localStorage.setItem('token',token);localStorage.setItem('selectedMarketplaceAccountId','olist-ts-comercio');},login.accessToken);
 let saved;
 await page.route('**/api/users**',async route=>{if(route.request().method()==='POST'){saved=route.request().postDataJSON();return route.fulfill({json:{id:'mock-user',...saved}});}return route.continue();});
 await page.goto('http://192.168.15.88:4201/usuarios');await page.getByRole('heading',{name:'Usuários',exact:true}).waitFor();
 assert.equal(await page.locator('mat-sidenav a[routerLink="/contas"]').count(),0);await page.locator('mat-sidenav a[routerLink="/usuarios"]').waitFor();
 await page.getByRole('button',{name:'Novo usuário',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Criar usuário',exact:true}).isDisabled(),true);
 await page.getByLabel('Nome',{exact:true}).fill('Usuário de teste');await page.getByLabel('E-mail',{exact:true}).fill('teste@example.com');await page.getByLabel('Senha inicial',{exact:false}).fill('senha-teste-123');await page.getByLabel('Perfil',{exact:true}).selectOption('CONSULTANT');await page.getByRole('button',{name:'Criar usuário',exact:true}).click();await page.getByText('Usuário salvo.',{exact:true}).waitFor();assert.equal(saved.role,'CONSULTANT');assert.equal(saved.active,true);
 await page.getByRole('button',{name:'Editar '+login.user.name,exact:true}).click();assert.equal(await page.getByLabel('Perfil',{exact:true}).isDisabled(),true);assert.equal(await page.getByLabel('Acesso ativo',{exact:true}).isDisabled(),true);
 await page.route('**/api/auth/me**',route=>route.fulfill({json:{id:'viewer',name:'Viewer',role:'VIEWER',permissions:['dashboard.view']}}));
 await page.goto('http://192.168.15.88:4201/usuarios');await page.waitForURL('**/dashboard');assert.equal(await page.locator('mat-sidenav a[routerLink="/usuarios"]').count(),0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({adminScreen:true,userForm:true,selfAccessProtected:true,nonAdminRedirect:true,menuRestricted:true,apiOmitsPasswords:true,noRealUserWrites:true,errors}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
