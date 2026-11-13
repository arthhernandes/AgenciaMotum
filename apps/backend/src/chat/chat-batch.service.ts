import {BadRequestException,ConflictException,Injectable,NotFoundException,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {randomUUID} from 'crypto';
import {PrismaService} from '../prisma/prisma.service';
import {ChatConversationService} from './chat-conversation.service';

export const BATCH_STAGES=['variations','fiscal','price'] as const;
export type BatchStage=typeof BATCH_STAGES[number];
export type BatchSpec={references:string[];stages:BatchStage[];price?:number;priceSource?:'bling'|'fixed';prices?:Record<string,number>};
export type BatchTask={dependsOnVariations?:boolean;stage:BatchStage;status:string;message:string;card?:any;selected?:boolean;publicationJobId?:string};
export type BatchRow={duplicateOf?:string;id:string;reference:string;title:string;tasks:BatchTask[];price?:number;priceSource?:'bling'|'fixed';blingPrices?:Record<string,number>;sizeChartId?:string;baseSku?:string;missingSkus?:string[];family?:string};
type Batch={conversationId?:string;status:string;rows:BatchRow[];leaseUntil?:number};
export type BatchRunner={prepare:(row:BatchRow,stage:BatchStage,accountId:string,userId:string,batchId:string)=>Promise<{dependsOnVariations?:boolean;card?:any;message:string;title?:string;skipped?:boolean}>;execute:(row:BatchRow,task:BatchTask,accountId:string,userId:string)=>Promise<any>;progress:(jobId:string,accountId:string,userId:string)=>Promise<any>;verify?:(row:BatchRow,task:BatchTask,accountId:string,userId:string)=>Promise<{status:string;message:string}>;discard?:(id:string,accountId:string,userId:string)=>Promise<any>};
function safeError(error:any){return error?.getResponse?String(error.getResponse()?.message??error.message).slice(0,700):'Não foi possível concluir esta etapa. Confira o resultado antes de repetir.';}

@Injectable()
export class ChatBatchService implements OnModuleInit,OnModuleDestroy{
 private timer?:ReturnType<typeof setInterval>;private ticking=false;private runner?:BatchRunner;
 constructor(private readonly prisma:PrismaService,private readonly conversations:ChatConversationService){}
 register(runner:BatchRunner){this.runner=runner;}
 onModuleInit(){this.timer=setInterval(()=>void this.tick().catch(()=>{}),2000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private where(id:string,accountId:string,userId:string){return {id,action:'CHAT_BATCH',entityType:'ChatBatch',entityId:accountId,userId};}
 private async load(id:string,accountId:string,userId:string){const record=await this.prisma.auditLog.findFirst({where:this.where(id,accountId,userId)});if(!record)throw new NotFoundException('Lote não encontrado nesta conversa e conta.');return record;}
 private async save(record:any,data:Batch){const result=await this.prisma.auditLog.updateMany({where:{id:record.id,after:{equals:record.after as Prisma.InputJsonValue}},data:{after:JSON.parse(JSON.stringify(data))}});if(result.count!==1)throw new ConflictException('O lote mudou em outra janela. Atualize para continuar.');record.after=JSON.parse(JSON.stringify(data));}
 async create(accountId:string,userId:string,spec:BatchSpec){
  if(!spec.references.length||spec.references.length>20||spec.references.some(ref=>!ref.trim()||ref.length>500)||!spec.stages.length||spec.stages.some(stage=>!BATCH_STAGES.includes(stage)))throw new BadRequestException('Escolha até 20 anúncios e as ações desejadas.');
  const validPrice=(value:any)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&Math.abs(value*100-Math.round(value*100))<0.0001;
  if(spec.price!=null&&!validPrice(spec.price)||Object.values(spec.prices??{}).some(value=>!validPrice(value)))throw new BadRequestException('Informe preços positivos com até duas casas decimais.');
  const references=[...new Set(spec.references.map(ref=>ref.trim()))];
  const data:Batch={status:'PREPARING',rows:references.map(reference=>({id:randomUUID(),reference,title:reference,price:spec.prices?.[reference]??spec.price,priceSource:spec.priceSource,tasks:BATCH_STAGES.filter(stage=>spec.stages.includes(stage)).map(stage=>({stage,status:'PREPARING',message:'Aguardando conferência.'}))}))};
  const record=await this.prisma.auditLog.create({data:{action:'CHAT_BATCH',entityType:'ChatBatch',entityId:accountId,userId,after:JSON.parse(JSON.stringify(data))}});
  return {id:record.id,...data};
 }
 async bind(id:string,accountId:string,userId:string,conversationId:string){const record=await this.load(id,accountId,userId);const data=structuredClone(record.after) as any;data.conversationId=conversationId;await this.save(record,data);}
 async snapshot(id:string,accountId:string,userId:string){const record=await this.load(id,accountId,userId);const data=structuredClone(record.after) as unknown as Batch;const all=data.rows.flatMap(row=>row.tasks);const tasks=data.status==='PREPARING'?all:all.some(task=>task.selected)?all.filter(task=>task.selected):all;const completed=tasks.filter(task=>data.status==='PREPARING'?task.status!=='PREPARING':['SUCCESS','SKIPPED','FAILED','UNKNOWN'].includes(task.status)).length;return {id:record.id,...data,progress:{completed,total:tasks.length,percent:tasks.length?Math.floor(completed/tasks.length*100):0}};}
 async replaceChild(key:string|undefined,cards:any[],accountId:string,userId:string){
  if(!key)return;const [batchId,rowId,stage]=key.split('|');const record=await this.load(batchId,accountId,userId);const data=structuredClone(record.after) as unknown as Batch;
    if(['RUNNING','PREPARING'].includes(data.status))throw new ConflictException('Aguarde o lote terminar antes de editar esta prévia.');
  const task=data.rows.find(row=>row.id===rowId)?.tasks.find(task=>task.stage===stage);if(!task||cards.length!==1)throw new BadRequestException('Prévia do lote inválida.');
  task.card=cards[0];task.status=task.stage==='fiscal'&&cards[0].confirmationLabel!=='Confirmar dados fiscais'?'REVIEW':'READY';task.message=task.status==='REVIEW'?'Revise os campos fiscais.':'Pronto para aplicar.';await this.save(record,data);
 }
 async retry(id:string,accountId:string,userId:string,rowId:string,edit:{reference?:string;price?:number;priceSource?:'bling'|'fixed';sizeChartId?:string;baseSku?:string}){
  const record=await this.load(id,accountId,userId);const data=structuredClone(record.after) as unknown as Batch;if(['RUNNING','PREPARING'].includes(data.status))throw new ConflictException('Aguarde a operação em andamento.');
  const row=data.rows.find(row=>row.id===rowId);if(!row)throw new BadRequestException('Anúncio não encontrado no lote.');
  if(edit.reference!==undefined){if(!edit.reference.trim()||edit.reference.length>500)throw new BadRequestException('Informe o anúncio correto.');if(row.tasks.some(task=>['SUCCESS','RUNNING','UNKNOWN'].includes(task.status)))throw new BadRequestException('O anúncio já teve uma execução. Crie outro pedido para mudar sua identificação.');row.reference=edit.reference.trim();}
  if(edit.price!==undefined){if(!Number.isFinite(edit.price)||edit.price<=0||Math.abs(edit.price*100-Math.round(edit.price*100))>0.0001)throw new BadRequestException('Preço inválido.');row.price=edit.price;row.priceSource='fixed';}
  if(edit.priceSource==='bling'){row.priceSource='bling';row.blingPrices=undefined;row.price=undefined;}
  if(edit.sizeChartId!==undefined){if(!/^\d{1,30}$/.test(edit.sizeChartId))throw new BadRequestException('Tabela de medidas inválida.');row.sizeChartId=edit.sizeChartId;}
  if(edit.baseSku!==undefined){if(!/^\d+(?:\.\d+)?$/.test(edit.baseSku))throw new BadRequestException('SKU base inválido.');row.baseSku=edit.baseSku;}
  for(const task of row.tasks)if(['UNKNOWN','FAILED'].includes(task.status)&&this.runner?.verify){try{const result=await this.runner.verify(row,task,accountId,userId);task.status=result.status;task.message=result.message;}catch(error){task.status='UNKNOWN';task.message=safeError(error);}}
  // Only read/preparation failures can be retried. Uncertain writes require checking.
  const newContext=edit.reference!==undefined||edit.baseSku!==undefined||edit.sizeChartId!==undefined;
  for(const task of row.tasks)if(['BLOCKED','REVIEW'].includes(task.status)||newContext&&['READY','SKIPPED'].includes(task.status)||task.stage==='price'&&task.status==='READY'&&(edit.price!=null||edit.priceSource)){task.status='PREPARING';task.message='Conferindo novamente.';}
  if(newContext)row.blingPrices=undefined;
  if(edit.reference!==undefined){row.family=undefined;row.duplicateOf=undefined;}
  data.status='PREPARING';await this.save(record,data);return this.snapshot(id,accountId,userId);
 }
 async start(id:string,accountId:string,userId:string,selections:Array<{rowId:string;stages:BatchStage[];actionIds?:Record<string,string>}>){
  const record=await this.load(id,accountId,userId);const data=structuredClone(record.after) as unknown as Batch;
  if(['RUNNING','PREPARING'].includes(data.status))throw new ConflictException('Aguarde o lote em andamento.');
  if(!selections.length||selections.length>20||new Set(selections.map(value=>value.rowId)).size!==selections.length)throw new BadRequestException('Selecione as ações prontas para aplicar.');
  for(const selection of selections){const row=data.rows.find(row=>row.id===selection.rowId);if(!row||!selection.stages.length||new Set(selection.stages).size!==selection.stages.length)throw new BadRequestException('Seleção inválida.');for(const stage of selection.stages){const task=row.tasks.find(task=>task.stage===stage);if(!task||task.status!=='READY')throw new BadRequestException('Revise as pendências antes de aplicar esta ação.');if(!selection.actionIds?.[stage]||selection.actionIds[stage]!==task.card?.id)throw new BadRequestException('A prévia mudou em outra janela. Confira os valores atuais antes de aplicar.');}}
  for(const selection of selections){const row=data.rows.find(row=>row.id===selection.rowId)!;if(selection.stages.includes('fiscal')&&row.tasks.find(task=>task.stage==='fiscal')?.dependsOnVariations&&!selection.stages.includes('variations')&&row.tasks.find(task=>task.stage==='variations')?.status!=='SUCCESS')throw new BadRequestException('Os dados fiscais incluem variações a publicar. Selecione a publicação dessas variações primeiro.');}
  for(const row of data.rows)for(const task of row.tasks)task.selected=selections.some(selection=>selection.rowId===row.id&&selection.stages.includes(task.stage));
  data.status='RUNNING';await this.save(record,data);return this.snapshot(id,accountId,userId);
 }
 private async attach(record:any,data:Batch){if(data.conversationId)await this.conversations.setBatchActions(record.entityId,record.userId,data.conversationId,record.id,data.rows.flatMap(row=>row.tasks.flatMap(task=>task.card?[task.card]:[])));}
 async tick(){
  if(this.ticking||!this.runner)return;this.ticking=true;
  try{const records=await this.prisma.auditLog.findMany({where:{action:'CHAT_BATCH',OR:[{after:{path:['status'],equals:'PREPARING'}},{after:{path:['status'],equals:'RUNNING'}}]},orderBy:{createdAt:'asc'},take:10});
   for(const record of records){if(!record.userId)continue;const data=JSON.parse(JSON.stringify(record.after)) as Batch;if(!data.conversationId||(data.leaseUntil??0)>Date.now())continue;data.leaseUntil=Date.now()+10*60_000;try{await this.save(record,data);}catch{continue;}
    try{
     if(data.status==='PREPARING'){
      for(const row of data.rows)for(const task of row.tasks)if(task.status==='PREPARING'){
       try{if(row.duplicateOf)throw new BadRequestException('Este anúncio pertence ao mesmo produto de outra linha. Use uma única linha para suas variações.');const oldId=task.card?.id;const result=await this.runner.prepare(row,task.stage,record.entityId,record.userId,record.id);const duplicate=row.family?data.rows.slice(0,data.rows.indexOf(row)).find(other=>other.family===row.family&&!other.duplicateOf):undefined;if(duplicate){row.duplicateOf=duplicate.id;if(result.card)await this.runner.discard?.(result.card.id,record.entityId,record.userId);throw new BadRequestException(`Este anúncio compartilha o pai com ${duplicate.reference}. Use uma única linha para evitar ações e preços duplicados.`);}if(!result.skipped&&!result.card)throw new BadRequestException('A prévia desta ação não foi preparada.');if(oldId&&oldId!==result.card?.id)await this.runner.discard?.(oldId,record.entityId,record.userId);row.title=result.title??row.title;task.card=result.card;task.dependsOnVariations=result.dependsOnVariations;task.message=result.message;task.status=result.skipped?'SKIPPED':task.stage==='fiscal'?'REVIEW':'READY';}
       catch(error){task.status='BLOCKED';task.message=safeError(error);}
       await this.save(record,data);await this.attach(record,data);
      }
      data.status='DRAFT';
     }else{
      for(const row of data.rows){let wait=false;
       for(const task of row.tasks){if(!task.selected)continue;
        if(task.status==='EXECUTING'){task.status='UNKNOWN';task.message='Execução interrompida. Confira o resultado antes de repetir.';continue;}
        if(task.status==='RUNNING'&&task.publicationJobId){try{const progress=await this.runner.progress(task.publicationJobId,record.entityId,record.userId);if(progress.published===progress.total&&progress.total>0){task.status='SUCCESS';task.message='Variações publicadas e conferidas.';}else if(progress.status==='FAILED'){task.status='FAILED';task.message=progress.message;}else if(progress.status==='WAITING_DATA'){task.status='BLOCKED';task.message=progress.message;}else{task.message=`${progress.published}/${progress.total} variações publicadas.`;wait=true;break;}}catch(error){task.status='UNKNOWN';task.message=safeError(error);}}
        if(task.status!=='READY')continue;
        const prerequisite=row.tasks.find(value=>value.stage==='variations'&&value.selected);if(task.stage!=='variations'&&prerequisite&&prerequisite.status!=='SUCCESS'){task.selected=false;task.message='Aguardando a publicação das variações deste anúncio.';continue;}
        task.status='EXECUTING';await this.save(record,data);
        try{const result=await this.runner.execute(row,task,record.entityId,record.userId);task.message=result.message;task.status=result.reviewRequired?'REVIEW':result.publicationJobId?'RUNNING':result.success===false?'UNKNOWN':'SUCCESS';if(result.card)task.card=result.card;task.publicationJobId=result.publicationJobId;if(result.publicationJobId){wait=true;break;}}
        catch(error){task.status='UNKNOWN';task.message=safeError(error);}
        await this.save(record,data);
       }
       if(wait)continue;
      }
      if(!data.rows.some(row=>row.tasks.some(task=>task.selected&&task.status==='RUNNING')))data.status=data.rows.some(row=>row.tasks.some(task=>['FAILED','UNKNOWN','BLOCKED','REVIEW'].includes(task.status)))?'PARTIAL':'COMPLETE';
     }
    }finally{data.leaseUntil=0;await this.save(record,data);await this.attach(record,data);}
   }
  }finally{this.ticking=false;}
 }
}
