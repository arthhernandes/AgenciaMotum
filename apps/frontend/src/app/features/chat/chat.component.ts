import { PermissionDirective } from '../../core/permission.directive';
import { AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';
import { ProgressBarModule } from 'primeng/progressbar';
import { TooltipModule } from 'primeng/tooltip';
import { RouterLink } from '@angular/router';
import { ApiService, Page } from '../../core/api.service';
import { ChatTextPipe } from './chat-text.pipe';
import { DialogModule } from 'primeng/dialog';

interface SizeChartOption {id:string;name:string;type:string;sizes:string[];compatible:boolean;reason:string;rows:Array<{size:string;measurements:Array<{name:string;value:string}>}>;}
type BatchStage='variations'|'fiscal'|'price';
interface BatchTask{dependsOnVariations?:boolean;stage:BatchStage;status:string;message:string;card?:ChatAction;}
interface BatchRow{id:string;reference:string;title:string;price?:number;priceSource?:'bling'|'fixed';sizeChartId?:string;baseSku?:string;tasks:BatchTask[];}
interface ChatBatch{id:string;status:string;rows:BatchRow[];progress:{percent:number;completed:number;total:number};}
interface SizeChartDraft {id:string;modelMlb:string;name:string;productName:string;measureType:string;requiredSizes?:string[];fields:Array<{id:string;name:string;required:boolean}>;equivalents:Array<{id:string;name:string}>;rows:Array<{size:string;equivalentId:string|null;measurements:Record<string,number|null>}>;warnings:string[];}


interface ChatAction { batchKey?:string;fiscal?:boolean; id: string; label: string; modelMlb?:string;confirmationLabel?:string;preview?: Array<{correspondence?:boolean;missingReview?:boolean;reference?:string;baseSku?:string;presentCount?:number;mlb:string;title:string;account:string;fields:Array<{sku?:string;missing?:boolean;mlb?:string;field:string;before:string;bling?:string;after:string}>;notes:string[]}>; state?: 'running' | 'waiting' | 'done' | 'error' | 'cancelled'; publicationJobId?:string; result?: string; destination?: string; }
interface ChatMessage { batchId?:string;role: 'user' | 'assistant'; content: string; variantPreview?:NonNullable<ChatAction['preview']>;actions?: ChatAction[]; operations?: Array<{ name: string; success: boolean; error?: string }>; }
interface ChatHistoryEntry {
  id: string; createdAt: string; completedAt: string | null; label: string; kind: string; status: string; account: string;
  user: {name:string;email:string}; message: string; preview: NonNullable<ChatAction['preview']>;
  reference: string; sku: string; destination: string; results: Array<{mlb:string;success:boolean;message:string}>;
}

@Component({
  selector: 'app-chat', standalone: true, imports: [PermissionDirective,CommonModule, FormsModule, ReactiveFormsModule, RouterLink, ButtonModule, AvatarModule, TagModule, MessageModule, TextareaModule, ProgressBarModule, TooltipModule, ChatTextPipe, DialogModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class ChatComponent implements OnInit, AfterViewChecked, OnDestroy {
  private publicationTimers=new Map<string,ReturnType<typeof setTimeout>>();
  private publicationGeneration=0;
  private destroyed=false;
  @ViewChild('messageList') list?: ElementRef<HTMLElement>;
  readonly draft = new FormControl('');
  messages: ChatMessage[] = [];
  conversationId = '';
  selectedConversationId = ''; 
  scopeMode:'listing'|'product'|'multiple'='listing';
  scopeReference='';scopeEditing=true;
  revisionColors:Record<string,string>={};
  fiscalLabels:Record<string,string>={ncm:'NCM',cest:'CEST',origin_type:'Tipo de origem',origin_detail:'Código de origem',ean:'GTIN / EAN',measurement_unit:'Unidade de medida',cost:'Custo de aquisição (R$)',csosn:'CSOSN (Simples Nacional)',tax_rule_id:'ID da regra tributária (Regime Normal)',fci:'FCI',ex_tipi:'Exceção TIPI',med_anvisa_code:'Código Anvisa',med_exemption_reason:'Motivo de isenção Anvisa',net_weight:'Peso líquido (kg)',gross_weight:'Peso bruto (kg)'};
  fiscalGroups=[{title:'Classificação e identificação',fields:['ncm','cest','origin_type','origin_detail','ean']},{title:'Unidade, custo e pesos',fields:['measurement_unit','cost','net_weight','gross_weight']},{title:'Tributação',fields:['csosn','tax_rule_id','fci','ex_tipi']},{title:'Medicamentos · quando aplicável',fields:['med_anvisa_code','med_exemption_reason']}];
  fiscalCurrent(row:any,field:string){const value=field==='cost'||field==='measurement_unit'?row.current?.[field]:row.current?.tax_information?.[field];return value==null||value===''?'Não informado':String(value);}
  fiscalChanged(row:any,field:string){const current=this.fiscalCurrent(row,field);return current!=='Não informado'&&!!row.values[field]&&current!==String(row.values[field]);}
  fiscalRequirement(row:any,field:string){
    if(['ncm','origin_type','origin_detail'].includes(field))return 'Obrigatório';
    const regime=this.fiscalDraft?.regime;
    if(field==='csosn')return regime==='simples'?'Obrigatório':regime==='normal'?'Não se aplica':'Depende do regime';
    if(field==='tax_rule_id')return regime==='normal'?'Obrigatório':regime==='simples'?'Não se aplica':'Depende do regime';
    if(field==='med_anvisa_code')return /^300[1-6]/.test((row.values.ncm??'').replace(/[.\s-]/g,''))?'Obrigatório':'Não se aplica';
    if(field==='med_exemption_reason')return row.values.med_anvisa_code==='ISENTO'?'Obrigatório':'Não se aplica';
    if(field==='cest')return 'Conforme enquadramento';
    if(field==='fci'&&!['3','5','8'].includes(row.values.origin_detail))return 'Não se aplica';
    return 'Opcional';
  }
  fiscalDialogOpen=false;fiscalLoading=false;fiscalError='';fiscalDraft:any;fiscalAction?:ChatAction;fiscalFields=['ncm','cest','origin_type','origin_detail','ean','measurement_unit','cost','csosn','tax_rule_id','fci','ex_tipi','med_anvisa_code','med_exemption_reason','net_weight','gross_weight'];
  analyzeNcm(action:ChatAction){
    if(this.busy||this.actionBusy||this.conversationLoading||action.state)return;
    this.actionBusy=true;this.error='';
    this.api.post<{message:string;actions:ChatAction[]}>(`/chat/actions/${action.id}/ncm`,{conversationId:this.conversationId}).subscribe({next:result=>{for(const message of this.messages)if(message.actions?.includes(action))message.actions=message.actions.flatMap(card=>card===action?result.actions:[card]);this.actionBusy=false;this.refreshBatchForAction(action);},error:error=>{this.actionBusy=false;this.error=this.apiError(error);}});
  }
  openFiscal(action:ChatAction){this.fiscalAction=action;this.fiscalDraft=undefined;this.fiscalDialogOpen=true;this.fiscalLoading=true;this.fiscalError='';this.api.get<any>(`/chat/actions/${action.id}/fiscal`).subscribe({next:draft=>{this.fiscalDraft=draft;this.fiscalLoading=false;},error:error=>{this.fiscalError=this.apiError(error);this.fiscalLoading=false;}});}
  approveFiscal(){const action=this.fiscalAction;if(!action||!this.fiscalDraft)return;this.fiscalLoading=true;this.fiscalError='';this.api.post<{actions:ChatAction[]}>(`/chat/actions/${action.id}/fiscal`,{...this.fiscalDraft,conversationId:this.conversationId}).subscribe({next:result=>{for(const message of this.messages)if(message.actions?.includes(action))message.actions=message.actions.flatMap(card=>card===action?result.actions:[card]);this.fiscalLoading=false;this.fiscalDialogOpen=false;this.refreshBatchForAction(action);},error:error=>{this.fiscalLoading=false;this.fiscalError=this.apiError(error);}});}
  chartDialogOpen=false;chartLoading=false;chartError='';charts:SizeChartOption[]=[];selectedChartId='';chartModelMlb='';chosenSizeChartId='';chosenSizeChartName='';private chartAction?:ChatAction;
  previewCharts:Record<string,{loading:boolean;error:string;charts:SizeChartOption[];selectedId:string;appliedId:string;modelMlb:string}>={};
  chartEditorMode:'choose'|'source'|'review'='choose';chartText='';chartImage='';chartImageName='';chartMeasureType:'CLOTHING_MEASURE'|'BODY_MEASURE'='CLOTHING_MEASURE';chartDraft?:SizeChartDraft;chartCreated=false;
  guideName(action:ChatAction){return action.preview?.flatMap(preview=>preview.fields).find(field=>field.field==='Tabela de medidas')?.after??'Confira ou escolha o guia para este anúncio.';}
  previewChartReady(action:ChatAction){const entry=this.previewCharts[action.id];return !!entry?.charts.some(chart=>chart.id===entry.selectedId&&chart.compatible);}
  chartSelectionDirty(action:ChatAction){const entry=this.previewCharts[action.id];return !!entry&&entry.selectedId!==entry.appliedId;}
  loadPreviewCharts(action:ChatAction){
    if(action.state||action.confirmationLabel!=='Confirmar e publicar'||!this.canRevise(action)||this.previewCharts[action.id])return;
    const entry:{loading:boolean;error:string;charts:SizeChartOption[];selectedId:string;appliedId:string;modelMlb:string}=this.previewCharts[action.id]={loading:true,error:'',charts:[],selectedId:'',appliedId:'',modelMlb:action.modelMlb??action.preview?.[0]?.mlb??''};
    this.api.get<{modelMlb:string;currentChartId:string|null;selectedChartId?:string|null;charts:SizeChartOption[]}>('/chat/size-charts',{anuncio:entry.modelMlb,actionId:action.id}).subscribe({next:result=>{entry.modelMlb=result.modelMlb;entry.charts=result.charts;entry.selectedId=result.selectedChartId??result.currentChartId??'';entry.appliedId=entry.selectedId;entry.loading=false;},error:error=>{entry.loading=false;entry.error=this.apiError(error);}});
  }
  usePreviewChart(action:ChatAction){const entry=this.previewCharts[action.id];if(!entry)return;this.chartAction=action;this.charts=entry.charts;this.selectedChartId=entry.selectedId;this.chartModelMlb=entry.modelMlb;this.applySizeChart();}
  startChartCreation(action?:ChatAction,reference?:string){
    if(this.busy||this.actionBusy)return;const model=action?.modelMlb??reference??action?.preview?.[0]?.mlb??this.chartReference();if(!model){this.error='Escolha o anúncio da prévia antes de criar o guia.';return;}
    this.chartAction=action;this.chartModelMlb=model;this.charts=[];this.chartDialogOpen=true;this.chartEditorMode='source';this.chartText='';this.chartImage='';this.chartImageName='';this.chartError='';this.chartDraft=undefined;this.chartCreated=false;
  }
  readChartPhoto(event:Event){
    this.chartImage='';this.chartImageName='';const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){this.chartError='Escolha uma foto JPG, PNG ou WebP de até 5 MB.';return;}
    const reader=new FileReader();reader.onload=()=>{this.chartImage=String(reader.result);this.chartImageName=file.name;this.chartError='';};reader.onerror=()=>this.chartError='Não foi possível ler esta foto.';reader.readAsDataURL(file);
  }
  extractChart(){
    if(this.chartLoading||this.actionBusy||(!this.chartText.trim()&&!this.chartImage))return;this.chartLoading=true;this.chartError='';
    this.api.post<SizeChartDraft>('/chat/size-charts/drafts',{anuncio:this.chartModelMlb,...(this.chartAction?{actionId:this.chartAction.id}:{}),text:this.chartText,...(this.chartImage?{image:this.chartImage}:{}),measureType:this.chartMeasureType}).subscribe({next:draft=>{this.chartDraft=draft;this.chartModelMlb=draft.modelMlb;this.chartLoading=false;this.chartEditorMode='review';},error:error=>{this.chartLoading=false;this.chartError=this.apiError(error);}});
  }
  editChartMeasure(row:SizeChartDraft['rows'][number],field:string,value:string){const text=value.trim().replace(',','.');const number=Number(text);row.measurements[field]=text&&Number.isFinite(number)?number:null;}
  get missingChartSizes(){const draft=this.chartDraft;const keys=draft?.rows.map(row=>row.size.trim().toUpperCase())??[];return (draft?.requiredSizes??[]).filter(size=>!keys.includes(size.trim().toUpperCase())&&!keys.includes(size.trim().toUpperCase()==='XXG'?'XGG':size.trim().toUpperCase()==='XGG'?'XXG':size.trim().toUpperCase()));}
  addChartRow(){const draft=this.chartDraft;if(!draft||draft.rows.length>=50)return;const size=this.missingChartSizes[0]??'';const matches=draft.equivalents.filter(value=>value.name.trim().toUpperCase()===size.trim().toUpperCase());draft.rows.push({size,equivalentId:matches.length===1?matches[0].id:null,measurements:Object.fromEntries(draft.fields.map(field=>[field.id,null]))});}
  canCreateChart(){const draft=this.chartDraft;if(!draft?.rows.length||this.chartCreated)return false;const keys=draft.rows.map(row=>row.size.trim().toUpperCase());return new Set(keys).size===keys.length&&(draft.requiredSizes??[]).every(size=>keys.includes(size.trim().toUpperCase())||keys.includes(size.trim().toUpperCase()==='XXG'?'XGG':size.trim().toUpperCase()==='XGG'?'XXG':size.trim().toUpperCase()))&&draft.rows.every(row=>row.size.trim()&&draft.equivalents.some(value=>value.id===row.equivalentId)&&draft.fields.every(field=>{const value=row.measurements[field.id];return value==null?!field.required:Number.isFinite(value)&&value>0&&value<=10000;}));}
  createChart(){
    if(!this.chartDraft||!this.canCreateChart()||this.actionBusy||this.chartLoading)return;this.actionBusy=true;this.chartError='';const draft=this.chartDraft;
    this.api.post<{id:string;name:string;modelMlb:string}>(`/chat/size-charts/drafts/${draft.id}/create`,{rows:draft.rows}).subscribe({next:created=>{this.actionBusy=false;this.chartCreated=true;this.chartEditorMode='choose';this.chartModelMlb=created.modelMlb;this.selectedChartId=created.id;this.charts=[...this.charts.filter(chart=>chart.id!==created.id),{id:created.id,name:created.name,type:'SPECIFIC',sizes:draft.rows.map(row=>row.size),compatible:true,reason:'',rows:draft.rows.map(row=>({size:row.size,measurements:draft.fields.filter(field=>row.measurements[field.id]!=null).map(field=>({name:field.name,value:`${row.measurements[field.id]} cm`}))}))}];this.applySizeChart();},error:error=>{this.actionBusy=false;this.chartError=this.apiError(error);this.chartDialogOpen=true;}});
  }
  get selectedChart(){return this.charts.find(chart=>chart.id===this.selectedChartId);}
  chartReference(){
    if(this.scopeMode==='listing'&&this.scopeReference.trim())return this.scopeReference.trim();
    for(const message of [...this.messages].reverse()){const action=message.actions?.find(action=>action.modelMlb||action.preview?.[0]?.mlb?.startsWith('MLB'));if(action)return action.modelMlb??action.preview![0].mlb;if(message.variantPreview?.length)return message.variantPreview[0].mlb;}
    return '';
  }
  openSizeCharts(action?:ChatAction,referenceOverride?:string){
    if(this.busy||this.actionBusy||this.chartLoading)return;
    const reference=referenceOverride??action?.modelMlb??action?.preview?.[0]?.mlb??this.chartReference();if(!reference){this.error='Escolha um anúncio no contexto da conversa para consultar suas tabelas de medidas.';return;}
    this.chartEditorMode='choose';
    this.chartDialogOpen=true;this.chartLoading=true;this.chartError='';this.charts=[];this.selectedChartId='';this.chartModelMlb='';this.chartAction=action;
    const sizes=[...new Set(this.messages.flatMap(message=>message.variantPreview??[]).flatMap(preview=>preview.fields.filter(field=>field.field.startsWith('Tamanho ')).map(field=>field.field.slice(8))))];
    this.api.get<{modelMlb:string;currentChartId:string|null;selectedChartId?:string|null;charts:SizeChartOption[]}>('/chat/size-charts',{anuncio:reference,...(action?{actionId:action.id}:{}),sizes:sizes.join(',')}).subscribe({next:result=>{this.charts=result.charts;this.chartModelMlb=result.modelMlb;this.selectedChartId=this.charts.some(chart=>chart.id===(result.selectedChartId??result.currentChartId)&&chart.compatible)?(result.selectedChartId??result.currentChartId)!:'';this.chartLoading=false;},error:error=>{this.chartError=this.apiError(error);this.chartLoading=false;}});
  }
  applySizeChart(){
    if(this.busy||this.actionBusy||this.chartLoading||!this.selectedChart?.compatible)return;
    if(this.batchChartContext){const context=this.batchChartContext;const batch=this.batches[context.batchId];const row=batch?.rows.find(row=>row.id===context.rowId);const chartId=this.selectedChart.id;this.batchChartContext=undefined;this.chartDialogOpen=false;if(batch&&row)this.reviseBatch(batch,row,false,chartId);return;}
    const chart=this.selectedChart;const action=this.chartAction??[...this.messages].reverse().flatMap(message=>message.actions??[]).find(action=>!action.state&&this.canRevise(action)&&(action.modelMlb===this.chartModelMlb||action.preview?.[0]?.mlb===this.chartModelMlb));
    if(action){this.actionBusy=true;this.chartError='';this.api.post<{message:string;actions:ChatAction[]}>(`/chat/actions/${action.id}/size-chart`,{sizeChartId:chart.id,conversationId:this.conversationId}).subscribe({next:result=>{for(const message of this.messages){if(message.actions?.some(card=>card===action))message.actions=message.actions.flatMap(card=>card===action?result.actions:[card]);}delete this.previewCharts[action.id];this.chosenSizeChartId=chart.id;this.chosenSizeChartName=chart.name;result.actions.forEach(card=>this.loadPreviewCharts(card));this.actionBusy=false;this.chartDialogOpen=false;this.refreshBatchForAction(action);},error:error=>{this.actionBusy=false;this.chartError=this.apiError(error);this.chartDialogOpen=true;}});}
    else{this.chosenSizeChartId=chart.id;this.chosenSizeChartName=chart.name;this.chartDialogOpen=false;if(!this.messages.some(message=>message.role==='user'&&/adicion|complet/i.test(message.content)&&/varia|cores|tamanhos/i.test(message.content)))return;this.draft.setValue(`Use a tabela de medidas ${chart.name} (ID ${chart.id}) para o anúncio ${this.chartModelMlb}. Continue preparando a prévia das variações solicitadas, preservando o preço escolhido.`);this.send();}
  }
  priceValues=new Map<ChatMessage,string>();
  priceChangeContext(){const user=[...this.messages].reverse().find(message=>message.role==='user')?.content.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()??'';return /preco|valor/.test(user)&&/alter|mud|ajust|atualiz|defin|deix|fix/.test(user)&&!/adicion|inclu|complet|acresc/.test(user);}
  priceControlMessage():ChatMessage|undefined {
    const latest=this.messages.at(-1);
    if(latest?.role!=='assistant'||latest.actions?.some(action=>!action.state))return undefined;
    const text=latest.content.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const lastUser=[...this.messages].reverse().find(message=>message.role==='user')?.content??'';
    if(this.priceChangeContext()&&/(?:R\$\s*\d+|\b\d+[.,]\d{2}\b)/i.test(lastUser))return undefined;
    if(!/\?/.test(text)||/previa preparada|proposta preparada/.test(text))return undefined;
    return /(?:qual|que|escolha|defin|inform)[^.\n]{0,100}(?:preco|valor)|(?:preco|valor)[^.\n]{0,100}\?/.test(text)?latest:undefined;
  }
  priceValue(message:ChatMessage){return this.priceValues.get(message)??'';}
  validPrice(message:ChatMessage){const raw=this.priceValue(message).trim();return /^\d+(?:[.,]\d{1,2})?$/.test(raw)&&Number(raw.replace(',','.'))>0;}
  answerPrice(message:ChatMessage,keepCurrent:boolean){
    if(this.busy||this.actionBusy||this.conversationLoading||!this.configured||(!keepCurrent&&!this.validPrice(message)))return;
    const price=Number(this.priceValue(message).replace(',','.')).toFixed(2).replace('.',',');
    this.draft.setValue(this.priceChangeContext()?(keepCurrent?'Mantenha o preço atual deste anúncio. Continue somente a revisão de preço.':`Altere o preço deste anúncio para R$ ${price}. Prepare somente a prévia da alteração de preço.`):(keepCurrent?'Mantenha o preço atual do anúncio para as variações. Continue preparando a prévia das cores e tamanhos solicitados.':`Use o preço de R$ ${price} para as variações. Continue preparando a prévia das cores e tamanhos solicitados.`));
    this.send();
  }
  chooseScope(mode:'listing'|'product'|'multiple'){this.scopeMode=mode;this.scopeReference='';this.scopeEditing=true;this.chosenSizeChartId='';this.chosenSizeChartName='';}
  saveScope(after?:()=>void){if(this.busy||this.actionBusy||!this.conversationId||!this.scopeReference.trim())return;this.busy=true;this.error='';
    this.api.post<{mode:'listing'|'product'|'multiple';reference:string}>(`/chat/conversations/${this.conversationId}/scope`,{mode:this.scopeMode,reference:this.scopeReference}).subscribe({next:scope=>{this.scopeMode=scope.mode;this.scopeReference=scope.reference;this.scopeEditing=false;const conversation=this.conversations.find(value=>value.id===this.conversationId);if(conversation)conversation.title=scope.reference.slice(0,90);this.busy=false;after?.();},error:error=>{this.busy=false;this.error=this.apiError(error);}});
  }
  canRevise(action:ChatAction){return !action.state&&action.preview?.some(preview=>preview.fields.some(field=>field.field.startsWith('Tamanho ')));}
  revise(action:ChatAction){const colors=this.revisionColors[action.id]?.trim();if(!colors||this.busy||this.actionBusy)return;this.actionBusy=true;this.error='';
    this.api.post<{message:string;actions:ChatAction[]}>(`/chat/actions/${action.id}/revise`,{colors,conversationId:this.conversationId}).subscribe({next:result=>{action.state='cancelled';action.result='Prévia substituída pela versão completa abaixo.';this.messages.push({role:'user',content:`Acrescente à prévia as cores: ${colors}`},{role:'assistant',content:result.message,actions:result.actions});result.actions.forEach(action=>this.loadPreviewCharts(action));this.actionBusy=false;this.scrollPending=true;},error:error=>{this.actionBusy=false;this.error=this.apiError(error);}});
  }
  conversations: Array<{id:string;title:string;createdAt:string}> = [];
  conversationLoading = true;
  configured = false;
  provider = 'openai';
  checking = true;
  busy = false;
  private actionWorking=false;
  private actionProgressTimer?:ReturnType<typeof setInterval>;
  actionProgress=0;
  publicationProgress:Record<string,{percent:number;published:number;total:number}>={};
  get actionBusy(){return this.actionWorking;}
  set actionBusy(value:boolean){
    this.actionWorking=value;if(this.actionProgressTimer)clearInterval(this.actionProgressTimer);
    if(value){this.actionProgress=5;this.actionProgressTimer=setInterval(()=>{this.actionProgress=Math.min(90,this.actionProgress+Math.max(1,Math.round((90-this.actionProgress)/12)));},1500);}
  }
  error = '';
  statusError = '';
  accountName = 'selecionada';
  showHistory = false;
  historyLoading = false;
  historyError = '';
  historyKind = 'all';
  historyPage = 1;
  historyPages = 1;
  historyTotal = 0;
  history: ChatHistoryEntry[] = [];
  private scrollPending = false;
  suggestions = ['Quais anúncios têm SKU não encontrado na Bling?', 'Como está a última sincronização?', 'Sincronize os anúncios do Mercado Livre'];
  constructor(private readonly api: ApiService) {}
  batches:Record<string,ChatBatch>={};batchFocus:Record<string,string>={};batchSelection:Record<string,boolean>={};batchEdits:Record<string,{reference:string;price:string;baseSku:string}>={};
  private batchTimers=new Map<string,ReturnType<typeof setTimeout>>();private batchChartContext?:{batchId:string;rowId:string};
  batchStageLabel(stage:BatchStage){return {variations:'Variações',fiscal:'Dados fiscais',price:'Preço'}[stage];}
  batchTask(row:BatchRow,stage:BatchStage){return row.tasks.find(task=>task.stage===stage);}
  batchStatus(status:string){return ({PREPARING:'Conferindo',READY:'Pronto para aplicar',REVIEW:'Revisão necessária',BLOCKED:'Precisa de informação',EXECUTING:'Aplicando',RUNNING:'Em andamento',SUCCESS:'Concluído',SKIPPED:'Sem alteração',FAILED:'Falhou',UNKNOWN:'Conferir resultado'} as Record<string,string>)[status]??status;}
  batchLocked(batch:ChatBatch){return ['PREPARING','RUNNING'].includes(batch.status);}
  loadBatch(message:ChatMessage){
    if(!message.batchId)return;const id=message.batchId;const generation=this.conversationRequest;const previous=this.batchTimers.get(id);if(previous)clearTimeout(previous);
    this.api.get<ChatBatch>(`/chat/batches/${id}`).subscribe({next:batch=>{if(this.destroyed||generation!==this.conversationRequest)return;this.batches[id]=batch;message.actions=batch.rows.flatMap(row=>row.tasks.flatMap(task=>task.card?[{...task.card,...(['SUCCESS','SKIPPED'].includes(task.status)?{state:'done' as const,result:task.message}:['EXECUTING','RUNNING'].includes(task.status)?{state:'running' as const,result:task.message}:['FAILED','UNKNOWN'].includes(task.status)?{state:'error' as const,result:task.message}:{})}]:[]));for(const row of batch.rows)this.batchEdits[row.id]??={reference:row.reference,price:row.price?.toFixed(2).replace('.',',')??'',baseSku:row.baseSku??''};if(this.batchLocked(batch))this.batchTimers.set(id,setTimeout(()=>this.loadBatch(message),2500));},error:error=>{if(this.destroyed||generation!==this.conversationRequest)return;this.error=this.apiError(error);this.batchTimers.set(id,setTimeout(()=>this.loadBatch(message),10000));}});
  }
  refreshBatchForAction(action:ChatAction){const id=action.batchKey?.split('|')[0];const message=this.messages.find(message=>message.batchId===id);if(message)this.loadBatch(message);}
  actionsForMessage(message:ChatMessage){if(!message.batchId)return message.actions??[];const rowId=this.batchFocus[message.batchId];return (message.actions??[]).filter(action=>action.batchKey?.split('|')[1]===rowId);}
  batchSelectable(row:BatchRow,task:BatchTask){return task.status==='READY'&&(!task.dependsOnVariations||row.tasks.find(value=>value.stage==='variations')?.status==='SUCCESS'||row.tasks.find(value=>value.stage==='variations')?.status==='READY'&&this.batchSelection[`${row.id}:variations`]);}
  selectReady(batch:ChatBatch){for(const row of batch.rows)for(const task of row.tasks)if(this.batchSelectable(row,task))this.batchSelection[`${row.id}:${task.stage}`]=true;}
  selectedBatchTasks(batch:ChatBatch){return batch.rows.map(row=>{const tasks=row.tasks.filter(task=>this.batchSelectable(row,task)&&this.batchSelection[`${row.id}:${task.stage}`]);return {rowId:row.id,stages:tasks.map(task=>task.stage),actionIds:Object.fromEntries(tasks.map(task=>[task.stage,task.card!.id]))};}).filter(row=>row.stages.length);}
  applyBatch(batch:ChatBatch){if(this.batchLocked(batch)||this.busy||this.actionBusy)return;const selections=this.selectedBatchTasks(batch);if(!selections.length)return;this.actionBusy=true;this.api.post<ChatBatch>(`/chat/batches/${batch.id}/apply`,{conversationId:this.conversationId,selections}).subscribe({next:()=>{this.actionBusy=false;const message=this.messages.find(value=>value.batchId===batch.id);if(message)this.loadBatch(message);},error:error=>{this.actionBusy=false;this.error=this.apiError(error);}});}
  reviseBatch(batch:ChatBatch,row:BatchRow,useBling=false,chartId?:string){if(this.batchLocked(batch)||this.busy||this.actionBusy)return;const edit=this.batchEdits[row.id];const price=edit.price.trim()?Number(edit.price.replace(',','.')):undefined;if(!useBling&&price!==undefined&&(!Number.isFinite(price)||price<=0)){this.error='Informe um preço válido.';return;}this.actionBusy=true;this.api.post<ChatBatch>(`/chat/batches/${batch.id}/rows/${row.id}`,{conversationId:this.conversationId,...(edit.reference!==row.reference?{reference:edit.reference}:{}),...(!useBling&&price!==undefined?{price}:{}),...(useBling?{priceSource:'bling'}:{}),...(edit.baseSku?{baseSku:edit.baseSku}:{}),...(chartId?{sizeChartId:chartId}:{})}).subscribe({next:()=>{this.actionBusy=false;const message=this.messages.find(value=>value.batchId===batch.id);if(message)this.loadBatch(message);},error:error=>{this.actionBusy=false;this.error=this.apiError(error);}});}
  chooseBatchChart(batch:ChatBatch,row:BatchRow){this.batchChartContext={batchId:batch.id,rowId:row.id};this.openSizeCharts(undefined,row.reference);}
  ngOnInit() {
    this.checkStatus();
    this.loadConversation();
    this.api.get<Array<{id:string;displayName:string}>>('/marketplace-accounts/business').subscribe({next: accounts => this.accountName = accounts.find(a => a.id === localStorage.getItem('selectedMarketplaceAccountId'))?.displayName ?? 'selecionada'});
  }
  checkStatus() {
    this.checking = true; this.statusError = '';
    this.api.get<{configured:boolean;provider:string}>('/chat/status').subscribe({next: status => {this.configured = status.configured;this.provider=status.provider;this.checking = false;},error: () => {this.checking=false;this.statusError='Não foi possível conectar ao chat. Verifique o backend.';}});
  }
  useSuggestion(text: string) { this.draft.setValue(text); }
  private conversationStorageKey(){return `audita-chat-conversation:${localStorage.getItem('selectedMarketplaceAccountId')??''}`;}
  private conversationRequest=0;
  loadConversation(id?: string) {
    if(this.busy || this.actionBusy)return;
    for(const timer of this.batchTimers.values())clearTimeout(timer);this.batchTimers.clear();this.batchChartContext=undefined;this.publicationGeneration++;for(const timer of this.publicationTimers.values())clearTimeout(timer);this.publicationTimers.clear();
    const request=++this.conversationRequest;
    this.conversationLoading=true;this.error='';
    const remembered=id??sessionStorage.getItem(this.conversationStorageKey())??undefined;
    this.api.get<{scope?:{mode:'listing'|'product'|'multiple';reference:string};id:string;messages:ChatMessage[];conversations:Array<{id:string;title:string;createdAt:string}>}>('/chat/conversations',remembered?{id:remembered}:{}).subscribe({next: response=>{
      if(request!==this.conversationRequest)return;
      sessionStorage.setItem(this.conversationStorageKey(),response.id);
      this.previewCharts={};this.conversationId=response.id;this.selectedConversationId=response.id;this.messages=response.messages;this.messages.filter(message=>message.batchId).forEach(message=>this.loadBatch(message));this.conversations=response.conversations;this.conversationLoading=false;this.scrollPending=true;
      this.scopeMode=response.scope?.mode??'listing';this.scopeReference=response.scope?.reference??'';this.scopeEditing=!response.scope;this.revisionColors={};this.chosenSizeChartId='';this.chosenSizeChartName='';this.chartDialogOpen=false;
      this.fiscalDialogOpen=false;this.fiscalDraft=null;this.fiscalAction=undefined;this.priceValues.clear();this.draft.setValue('');this.publicationProgress={};
      const guide=[...this.messages].reverse().flatMap(message=>message.actions??[]).flatMap(action=>action.preview??[]).flatMap(preview=>preview.fields).find(field=>field.field==='Tabela de medidas');const match=guide?.after.match(/^(.+) · ID (\d+)$/);if(match){this.chosenSizeChartName=match[1];this.chosenSizeChartId=match[2];}
      for(const message of this.messages)for(const action of message.actions??[]){if(action.publicationJobId)this.watchPublication(action);else this.loadPreviewCharts(action);}
    },error: error=>{if(request!==this.conversationRequest)return;this.selectedConversationId=this.conversationId;this.conversationLoading=false;if(!id&&remembered&&error.status===404){sessionStorage.removeItem(this.conversationStorageKey());this.loadConversation();return;}this.error=this.apiError(error);}});
  }
  selectConversation(id: string) { if(id&&id!==this.conversationId&&!this.conversationLoading){this.selectedConversationId=id;this.loadConversation(id);} }
  clear() {
    if(this.busy || this.actionBusy || this.conversationLoading)return;
    this.conversationLoading=true;
    this.api.post<{id:string}>('/chat/conversations').subscribe({next: response=>{this.messages=[];this.error='';this.draft.setValue('');this.loadConversation(response.id);},error: error=>{this.error=this.apiError(error);this.conversationLoading=false;}});
  }
  toggleHistory() { this.showHistory=!this.showHistory;if(this.showHistory)this.loadHistory(1);else this.scrollPending=true; }
  loadHistory(page = this.historyPage) {
    this.historyLoading=true;this.historyError='';
    this.api.get<Page<ChatHistoryEntry>>('/chat/history',{page,limit:20,kind:this.historyKind}).subscribe({next: response=>{
      this.history=response.data;this.historyPage=response.pagination.page;this.historyPages=response.pagination.pages;this.historyTotal=response.pagination.total;this.historyLoading=false;
    },error: error=>{this.historyError=this.apiError(error);this.historyLoading=false;}});
  }
  filterHistory(kind: string) { this.historyKind=kind;this.loadHistory(1); }
  historyStatus(status: string) { return ({SUCCESS:'Concluída',RUNNING:'Em andamento',PARTIAL:'Resultado parcial',FAILED:'Falhou',CANCELLED:'Cancelada',UNVERIFIED:'Não verificada',PAUSED:'Pausada'} as Record<string,string>)[status] ?? 'Não verificada'; }
  historySeverity(status: string): 'success' | 'danger' | 'warn' | 'secondary' | 'info' {
    if(status==='SUCCESS')return 'success';if(status==='FAILED')return 'danger';if(['PARTIAL','UNVERIFIED','PAUSED'].includes(status))return 'warn';if(status==='RUNNING')return 'info';return 'secondary';
  }
  onKey(event: KeyboardEvent) { if(event.key === 'Enter' && !event.shiftKey && !event.isComposing){event.preventDefault();this.send();} }
  send() {
    const text=this.draft.value?.trim();
    if(!text || !this.configured || this.busy || this.actionBusy || this.conversationLoading || !this.conversationId) return;
    this.error='';this.busy=true;this.messages.push({role:'user',content:text});this.draft.setValue('');this.scrollPending=true;
    // The backend reconstructs context from the saved conversation.
    const history=[{role:'user',content:text}];
    this.api.post<{message:string;variantPreview?:NonNullable<ChatAction['preview']>;batchId?:string;actions:ChatAction[];operations:Array<{name:string;success:boolean;error?:string}>}>('/chat/messages',{messages:history,conversationId:this.conversationId,...(this.chosenSizeChartId?{sizeChartId:this.chosenSizeChartId}:{})}).subscribe({next: response=>{this.messages.push({role:'assistant',content:response.message,batchId:response.batchId,variantPreview:response.variantPreview,actions:response.actions,operations:response.operations});if(response.batchId)this.loadBatch(this.messages[this.messages.length-1]);response.actions.forEach(action=>this.loadPreviewCharts(action));const conversation=this.conversations.find(c=>c.id===this.conversationId);if(conversation?.title==='Nova conversa')conversation.title=text.slice(0,90);this.busy=false;this.scrollPending=true;},error: error=>{this.error=this.apiError(error);this.busy=false;this.messages.pop();this.draft.setValue(text);}});
  }
  confirm(action: ChatAction) {
    if(action.fiscal&&action.confirmationLabel==='Revisar dados fiscais'){this.openFiscal(action);return;}
    if(action.state || this.actionBusy || this.busy||this.chartSelectionDirty(action))return;
    this.actionBusy=true;action.state='running';
    this.api.post<{message:string;destination?:string;success?:boolean;publicationJobId?:string}>(`/chat/actions/${action.id}/confirm`,{conversationId:this.conversationId}).subscribe({next: result=>{action.state=result.success === false ? 'error' : result.publicationJobId ? 'running' : 'done';action.publicationJobId=result.publicationJobId;action.result=result.message;action.destination=result.destination;this.messages.push({role:'assistant',content:result.message});this.actionBusy=false;this.scrollPending=true;if(action.publicationJobId)this.watchPublication(action);},error: error=>{this.actionBusy=false;if(error.status===404&&action.confirmationLabel==='Confirmar e publicar'){this.refreshAction(action);return;}action.state='error';action.result=this.apiError(error);}});
  }
  cancel(action: ChatAction) {
    if(action.state || this.actionBusy || this.busy)return;
    this.actionBusy=true;
    this.api.post<{message:string}>(`/chat/actions/${action.id}/cancel`,{conversationId:this.conversationId}).subscribe({next: result=>{action.state='cancelled';action.result=result.message;this.messages.push({role:'assistant',content:result.message});this.actionBusy=false;this.scrollPending=true;},error: error=>{this.error=this.apiError(error);this.actionBusy=false;}});
  }
  canRefresh(action:ChatAction){return action.state==='error'&&action.confirmationLabel==='Confirmar e publicar'&&/expir|indispon/i.test(action.result??'');}
  refreshAction(action:ChatAction){
    if(this.actionBusy||this.busy)return;this.actionBusy=true;
    this.api.post<{message:string;actions:ChatAction[]}>(`/chat/actions/${action.id}/refresh`,{conversationId:this.conversationId}).subscribe({next:result=>{
      for(const message of this.messages)if(message.actions?.includes(action))message.actions=message.actions.flatMap(card=>card===action?result.actions:[card]);
      delete this.previewCharts[action.id];result.actions.forEach(card=>this.loadPreviewCharts(card));this.actionBusy=false;
    },error:error=>{this.actionBusy=false;action.state='error';action.result=this.apiError(error);}});
  }
  ngAfterViewChecked() { if(this.scrollPending && this.list){this.list.nativeElement.scrollTop=this.list.nativeElement.scrollHeight;this.scrollPending=false;} }
  ngOnDestroy(){for(const timer of this.batchTimers.values())clearTimeout(timer);this.conversationRequest++;this.destroyed=true;if(this.actionProgressTimer)clearInterval(this.actionProgressTimer);for(const timer of this.publicationTimers.values())clearTimeout(timer);}
  private watchPublication(action:ChatAction) {
    const generation=this.publicationGeneration;
    const poll=()=>{
      if(this.destroyed||generation!==this.publicationGeneration||!action.publicationJobId)return;
      this.api.get<{status:string;total:number;published:number;active:number;withoutStock:number;message:string}>(`/chat/publications/${action.publicationJobId}`).subscribe({next:progress=>{
        if(this.destroyed||generation!==this.publicationGeneration)return;
        action.state=progress.status==='COMPLETE'?'done':progress.status==='FAILED'?'error':['WAITING_STOCK','WAITING_DATA'].includes(progress.status)?'waiting':'running';
        this.publicationProgress[action.id]={percent:progress.total?Math.floor(progress.published/progress.total*100):0,published:progress.published,total:progress.total};
        action.result=`${progress.published}/${progress.total} variações publicadas · ${progress.active} ativas${progress.withoutStock?` · ${progress.withoutStock} sem estoque`:''}\n${progress.message}`;
        if(!['COMPLETE','FAILED'].includes(progress.status))this.publicationTimers.set(action.id,setTimeout(poll,['WAITING_STOCK','WAITING_DATA'].includes(progress.status)?30000:5000));
      },error:()=>{if(!this.destroyed&&generation===this.publicationGeneration)this.publicationTimers.set(action.id,setTimeout(poll,10000));}});
    };poll();
  }
  previewColor(title:string) { const index=title.lastIndexOf(' · Cor ');return index>=0 ? title.slice(index+7) : ''; }
  skuMatchCount(preview:NonNullable<ChatAction['preview']>[number]){return preview.fields.filter(field=>field.after.startsWith(field.before+' ·')).length;}
  private missingSelections=new Map<NonNullable<ChatAction['preview']>[number],Set<string>>();
  missingFields(preview:NonNullable<ChatAction['preview']>[number]){return preview.fields.filter(field=>field.missing&&field.sku);}
  missingSelection(preview:NonNullable<ChatAction['preview']>[number]){let selection=this.missingSelections.get(preview);if(!selection){selection=new Set();this.missingSelections.set(preview,selection);}return selection;}
  toggleMissing(preview:NonNullable<ChatAction['preview']>[number],sku:string){const selection=this.missingSelection(preview);if(selection.has(sku))selection.delete(sku);else selection.add(sku);}
  selectAllMissing(preview:NonNullable<ChatAction['preview']>[number]){const selection=this.missingSelection(preview);this.missingFields(preview).forEach(field=>selection.add(field.sku!));}
  addMissing(preview:NonNullable<ChatAction['preview']>[number]){
    const skus=[...this.missingSelection(preview)];if(!skus.length||!preview.reference||this.busy||this.actionBusy)return;
    this.busy=true;this.error='';const conversationId=this.conversationId;
    this.api.post<{message:string;actions:ChatAction[]}>('/chat/missing-variations/prepare',{conversationId,reference:preview.reference,skus}).subscribe({next:result=>{if(this.conversationId!==conversationId)return;this.messages.push({role:'user',content:`Adicionar as variações selecionadas no anúncio ${preview.reference}: ${skus.join(', ')}`},{role:'assistant',content:result.message,actions:result.actions});result.actions.forEach(action=>this.loadPreviewCharts(action));this.busy=false;this.scrollPending=true;this.missingSelection(preview).clear();},error:error=>{if(this.conversationId!==conversationId)return;this.busy=false;this.error=this.apiError(error);}});
  }
  expandedSkuPreviews=new Set<NonNullable<ChatAction['preview']>[number]>();
  toggleSkuPreview(preview:NonNullable<ChatAction['preview']>[number]){if(this.expandedSkuPreviews.has(preview))this.expandedSkuPreviews.delete(preview);else this.expandedSkuPreviews.add(preview);}
  previewSuggestionLabel(action:ChatAction,preview:NonNullable<ChatAction['preview']>[number]){return action.fiscal?'Sugestão':preview.fields.some(field=>field.field.includes('SKU')||field.field.startsWith('Tamanho '))?'SKU Bling':'Proposto';}
  orderedReviewPreviews(action:ChatAction){
    const previews=action.preview??[];if(!action.fiscal)return previews;
    const key=(title:string)=>{const match=/^(.*?)[\s-]+(XXG|GG|P|M|G)\s*(?:·\s*SKU\b.*)?$/i.exec(title);return {group:match?.[1]??title,rank:match?['P','M','G','GG','XXG'].indexOf(match[2].toUpperCase()):100};};
    return [...previews].sort((a,b)=>{const left=key(a.title),right=key(b.title);return left.group.localeCompare(right.group,'pt-BR',{sensitivity:'base'})||left.rank-right.rank;});
  }
  orderedPreviewFields(fields:Array<{sku?:string;missing?:boolean;mlb?:string;field:string;before:string;bling?:string;after:string}>) {
    const order=['P','M','G','GG','XXG'];
    const rank=(field:string) => {const match=field.match(/^Tamanho\s+(.+)$/);if(!match)return 200;const index=order.indexOf(match[1].trim().toUpperCase());return index<0 ? 100 : index;};
    return [...fields].sort((a,b)=>rank(a.field)-rank(b.field));
  }
  previewParent(title:string) { const index=title.lastIndexOf(' · Cor ');return index>=0 ? title.slice(0,index) : title; }
  operationLabel(name: string) {return ({consultar_produtos:'Catálogo consultado',consultar_anuncios:'Anúncios consultados',comparar_estoque:'Estoque consultado',consultar_sincronizacoes:'Sincronizações consultadas',preparar_sincronizacao:'Sincronização preparada',preparar_vinculo:'Vínculo preparado',consultar_contas_ml:'Contas consultadas',consultar_anuncio_ml:'Anúncio consultado ao vivo',consultar_categoria_ml:'Categoria consultada',preparar_alteracoes_ml:'Alterações preparadas',preparar_variacoes_ml:'Variações preparadas',preparar_publicacao_ml:'Publicação preparada'} as Record<string,string>)[name] ?? 'Consulta';}
  private apiError(error:any) { const message=error?.error?.message;return Array.isArray(message)?message.join(' '):message || 'Não foi possível concluir o pedido. Tente novamente.'; }
}







