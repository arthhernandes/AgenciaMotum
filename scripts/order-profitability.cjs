#!/usr/bin/env node
require('dotenv').config({quiet:true});
const fs=require('node:fs');
const {FinanceApi}=require('../apps/backend/dist/src/reports/finance-api');
const {ProfitabilityEngine}=require('../apps/backend/dist/src/reports/profitability-engine');
async function main(){
 const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
 const config=arg('--config')?JSON.parse(fs.readFileSync(arg('--config'),'utf8')):{};
 const token=process.env.ACCESS_TOKEN||config.ACCESS_TOKEN,seller=String(process.env.SELLER_ID||config.SELLER_ID||'');
 if(!token||!/^\d+$/.test(seller))throw Error('Configure ACCESS_TOKEN e SELLER_ID no ambiente ou no arquivo --config.');
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),dateTo=arg('--to')||config.dateTo||today,dateFrom=arg('--from')||config.dateFrom||new Date(Date.parse(dateTo)-29*86400000).toISOString().slice(0,10);
 const rawRate=arg('--tax-rate')??process.env.GENERAL_TAX_RATE??config.taxRate;
 const taxRate=rawRate===undefined||rawRate===null||String(rawRate).trim()===''?NaN:Number(rawRate);
 if(!Number.isFinite(taxRate)||taxRate<0||taxRate>100)throw Error('Informe --tax-rate entre 0 e 100, ou GENERAL_TAX_RATE ou taxRate no arquivo de configuração.');
 const api=new FinanceApi(async()=>token);if(String((await api.get('/users/me')).id)!==seller)throw Error('ACCESS_TOKEN não pertence ao SELLER_ID informado.');
 const engine=new ProfitabilityEngine(api,seller),rows=[],errors=[],seen=new Set();let offset=0,total=0,incomplete=false;
 do{
  try{const page=await engine.page({dateFrom,dateTo},taxRate,offset,50);total=page.total;for(const row of page.rows){const key=row.orderId+':'+row.itemIndex;if(!seen.has(key)){seen.add(key);rows.push(row);}}errors.push(...page.errors);incomplete||=page.incomplete;if(page.nextOffset===null)break;if(page.nextOffset<=offset)throw Error('Paginação não avançou');offset=page.nextOffset;}
  catch(error){errors.push({offset,message:error.message});incomplete=true;break;}
 }while(true);
 const result={sellerId:seller,dateFrom,dateTo,taxRate,totalOrders:total,incomplete,rows,errors,notes:['Custo fiscal: valor atual cadastrado no Mercado Livre, não custo histórico da compra.','Impostos: percentual geral informado pelo usuário, aplicado sobre a receita dos itens.','Linhas sem valores necessários não recebem lucro líquido nem margem.','Frete rateado pelos valores de venda de todos os itens do envio.'],generatedAt:new Date().toISOString()};
 if(arg('--out')){fs.writeFileSync(arg('--out'),JSON.stringify(result,null,2),'utf8');console.log(JSON.stringify({output:arg('--out'),orders:total,items:rows.length,incomplete,errors:errors.length}));}else process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(incomplete)process.exitCode=2;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
