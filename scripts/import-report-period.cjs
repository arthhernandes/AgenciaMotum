// Import through the same authenticated routes used by the report button.
require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
 const dateFrom=process.argv[2]||'2026-10-22',dateTo=process.argv[3]||'2026-10-23';
 const account=await p.marketplaceAccount.findFirstOrThrow({where:{businessKey:'outlet4u',marketplace:'MERCADO_LIVRE',active:true},select:{id:true}});
 const login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());if(!login.accessToken)throw Error('Local login failed');
 const headers={Authorization:'Bearer '+login.accessToken,'Content-Type':'application/json'},base='http://localhost:3001/api/reports/profitability',period={dateFrom,dateTo};
 async function request(path,body){const r=await fetch(base+path+'?marketplaceAccountId='+account.id,{headers,...(body?{method:'POST',body:JSON.stringify({...period,...body})}:{})});const data=await r.json();if(!r.ok)throw Error(path+': '+JSON.stringify(data));return data;}
 let offset=0,updated=0;do{const result=await request('/import-costs',{offset,limit:10});updated+=result.rows.filter(row=>row.fiscalCost!==null).length;offset=result.nextOffset;console.log(JSON.stringify({stage:'costs',nextOffset:offset,confirmed:updated}));}while(offset!==null);
 const query=new URLSearchParams({...period,marketplaceAccountId:account.id});const report=await fetch(base+'?'+query,{headers}).then(r=>r.json());if(!report.rows)throw Error('Report unavailable');
 const ids=[...new Set(report.rows.map(row=>row.itemId))];let confirmed=0,missing=0;
 for(let i=0;i<ids.length;i+=20){const data=await request('/import-advertising',{itemIds:ids.slice(i,i+20).join(',')});for(const entry of data.results){if(entry.cost===null)missing++;else confirmed++;}console.log(JSON.stringify({stage:'advertising',processed:Math.min(i+20,ids.length),total:ids.length,confirmed,missing}));}
 console.log(JSON.stringify({dateFrom,dateTo,rows:report.rows.length,confirmedFiscal:updated,advertisingConfirmed:confirmed,advertisingMissing:missing,trousers:report.rows.find(row=>row.orderId==='2000019112058182')}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
