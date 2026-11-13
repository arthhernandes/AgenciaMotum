require('dotenv').config({quiet:true});const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());if(!login.accessToken)throw Error('Local login unavailable');
 const headers={Authorization:'Bearer '+login.accessToken,'Content-Type':'application/json'},period={dateFrom:process.argv[2]||'2026-09-27',dateTo:process.argv[3]||'2026-10-26'};
 for(const businessKey of (process.argv[4]?[process.argv[4]]:['mottum','outlet4u'])){
  const account=await p.marketplaceAccount.findFirstOrThrow({where:{businessKey,marketplace:'MERCADO_LIVRE',active:true},select:{id:true}}),query=new URLSearchParams({...period,marketplaceAccountId:account.id});
  const before=await fetch('http://localhost:3001/api/reports/profitability/advertising-allocation?'+query,{headers}).then(r=>r.json());
  let offset=0,issues=0;do{
   const r=await fetch('http://localhost:3001/api/reports/profitability/import-advertising-allocation?marketplaceAccountId='+account.id,{method:'POST',headers,body:JSON.stringify({...period,offset,limit:10})}),data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));
   issues+=data.errors.length;offset=data.nextOffset;console.log(JSON.stringify({account:businessKey,nextOffset:offset,issues}));
  }while(offset!==null);
  const after=await fetch('http://localhost:3001/api/reports/profitability/advertising-allocation?'+query,{headers}).then(r=>r.json());
  const pending=(after.results||[]).filter(r=>r.cost===null);
  console.log(JSON.stringify({account:businessKey,beforePending:before.results?.filter(r=>r.cost===null).length,afterPending:pending.length,rows:after.results?.length,pendingSamples:pending.slice(0,3)}));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
