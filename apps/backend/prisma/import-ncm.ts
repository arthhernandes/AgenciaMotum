import {readFileSync} from 'fs';
import {PrismaClient} from '@prisma/client';
import {prepareNcmEntries} from '../src/ncm/ncm-catalog';
import {config} from 'dotenv';
config({path:'../../.env',quiet:true});
config({path:'.env',quiet:true});
const prisma=new PrismaClient();
async function main(){
  if(!process.argv[2])throw new Error('Informe o arquivo JSON extraído da planilha.');
  const entries=prepareNcmEntries(JSON.parse(readFileSync(process.argv[2],'utf8')));
  console.log(JSON.stringify({validated:entries.length,ncm:entries.filter(row=>row.level===8).length}));
  for(let start=0;start<entries.length;start+=200){await prisma.$transaction(entries.slice(start,start+200).map(row=>prisma.ncmEntry.upsert({where:{code:row.code},create:row,update:row})));if(start%5000===0)console.log(JSON.stringify({processed:Math.min(start+200,entries.length),total:entries.length}));}
  console.log(JSON.stringify({imported:await prisma.ncmEntry.count({where:{sourceHash:entries[0].sourceHash}}),ncm:await prisma.ncmEntry.count({where:{sourceHash:entries[0].sourceHash,level:8}})}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Falha na importação NCM');process.exitCode=1;}).finally(()=>prisma.$disconnect());
