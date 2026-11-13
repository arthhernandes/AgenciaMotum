#!/usr/bin/env node
require('dotenv').config({quiet:true});
const {PrismaClient}=require('@prisma/client');
const {spawn}=require('node:child_process');
const {join}=require('node:path');
const p=new PrismaClient(),args=process.argv.slice(2),id=args[args.indexOf('--job')+1];
const stages=[['ORDERS','import-order-history.cjs'],['COSTS','enrich-order-history.cjs'],['ADVERTISING_VISITS','import-advertising-visits.cjs']];
let state;
async function save(){await p.auditLog.update({where:{id},data:{after:JSON.parse(JSON.stringify(state))}});}
async function main(){
 if(!/^daily-reports:\d{4}-\d{2}-\d{2}$/.test(id))throw Error('Job inválido.');
 const job=await p.auditLog.findUniqueOrThrow({where:{id}});if(job.after.status!=='RUNNING')throw Error('Job inativo.');
 state={...job.after,processId:process.pid,completedStages:[]};await save();
 for(const [stage,script] of stages){
  state.stage=stage;await save();
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(__dirname,script)],{cwd:join(__dirname,'..'),windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>resolve(code));});
  // The importers use code 2 for partial results; keep updating the remaining sources.
  if(result!==0&&result!==2)throw Error('Etapa interrompida: '+stage);
  const action=stage==='ORDERS'?'ORDER_HISTORY_IMPORT':stage==='COSTS'?'ORDER_HISTORY_ENRICHMENT':'ADVERTISING_VISITS_IMPORT';
  const latest=await p.auditLog.findFirst({where:{action},orderBy:{createdAt:'desc'}});
  state.completedStages.push({stage,status:latest?.after?.status??'COMPLETED'});await save();
 }
 state.status=state.completedStages.every(row=>row.status==='COMPLETED')?'COMPLETED':'PARTIAL';state.finishedAt=new Date().toISOString();await save();
}
main().catch(async()=>{process.exitCode=1;if(state){state.status='FAILED';state.finishedAt=new Date().toISOString();state.message='Os dados já salvos foram preservados. Confira a etapa da sincronização.';await save().catch(()=>{});}}).finally(()=>p.$disconnect());
