const fs=require('fs');
(async()=>{
 const period={dateFrom:process.argv[2]||'2026-09-01',dateTo:process.argv[3]||'2026-09-30'},login=await fetch('http://localhost:3001/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com',password:'admin123'})}).then(r=>r.json());if(!login.accessToken)throw Error('Local login unavailable');
 const headers={Authorization:'Bearer '+login.accessToken,'Content-Type':'application/json'},audit=[];
 for(const account of ['meli-local-oauth','meli-mottum-oauth']){
  const r=await fetch('http://localhost:3001/api/reports/profitability/import-advertising-summary?marketplaceAccountId='+account,{method:'POST',headers,body:JSON.stringify(period)}),summary=await r.json();if(!r.ok)throw Error(JSON.stringify(summary));
  const q=new URLSearchParams({...period,marketplaceAccountId:account});const [report,allocation]=await Promise.all([fetch('http://localhost:3001/api/reports/profitability?'+q,{headers}).then(r=>r.json()),fetch('http://localhost:3001/api/reports/profitability/advertising-allocation?'+q,{headers}).then(r=>r.json())]);
  if(!Array.isArray(allocation.results)||!Array.isArray(report.rows))throw Error('Invalid report response');
  const unresolved=allocation.results.filter(row=>typeof row.cost!=='number'||!Number.isFinite(row.cost)||row.cost<0),unique=new Set(allocation.results.map(row=>row.orderId+':'+row.itemIndex));
  const result={account,...period,orders:report.rows.length,allocations:allocation.results.length,unique:unique.size,withCost:allocation.results.filter(row=>row.cost>0).length,noSpend:allocation.results.filter(row=>row.cost===0).length,pending:unresolved.length,providerPeriodCost:summary.cost,checkedAt:summary.checkedAt,samples:unresolved.slice(0,5)};audit.push(result);console.log(JSON.stringify(result));
  if(unresolved.length||unique.size!==report.rows.length||unique.size!==allocation.results.length)process.exitCode=1;
 }
 fs.writeFileSync('artifacts/confirmed-advertising-'+period.dateFrom+'-'+period.dateTo+'.json',JSON.stringify(audit,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
