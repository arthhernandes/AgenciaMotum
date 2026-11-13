import { FinanceApi, FinanceHttpError } from './finance-api';
import { cents, money } from './profitability-calculation';
import { validateProfitPeriod } from './profitability-engine';

/** Product Ads provides period totals, not a charge tied to an order. */
export class ProductAds {
  private periodPlans=new Map<string,Promise<Map<string,any[]>>>();
  constructor(private api:FinanceApi,private sellerId:string){}
  async memberships(){
    const startedAt=new Date().toISOString();
    const accounts=(await this.api.get('/advertising/advertisers',{product_id:'PADS'})).advertisers?.filter((account:any)=>account.site_id==='MLB');
    if(accounts?.length!==1||!/^\d+$/.test(String(accounts[0].advertiser_id)))throw Error('Anunciante não confirmado.');
    const advertiser=String(accounts[0].advertiser_id),base='/advertising/MLB/advertisers/'+advertiser+'/product_ads/';
    const campaigns=await this.pages(base+'campaigns/search',{}),ads=await this.pages(base+'ads/search',{}),byId=new Map<string,any>();
    for(const campaign of campaigns){if(String(campaign.advertiser_id)!==advertiser||byId.has(String(campaign.id)))throw Error('Campanhas incompletas ou duplicadas.');byId.set(String(campaign.id),campaign);}
    const seen=new Set<string>(),members:import('./advertising-membership').AdMembership[]=[],unknownIds:string[]=[];
    for(const ad of ads){
      if(!/^MLB\d+$/.test(ad.item_id)||String(ad.advertiser_id)!==advertiser||seen.has(ad.item_id))throw Error('Anúncios incompletos ou duplicados.');seen.add(ad.item_id);
      const campaignId=/^\d+$/.test(String(ad.campaign_id))?String(ad.campaign_id):null,campaign=campaignId?byId.get(campaignId):null;
      if(!['active','paused','idle','disabled','deleted','archived','inactive'].includes(ad.status)||ad.status==='active'&&(!campaign||!['active','paused','archived','deleted','inactive'].includes(campaign.status))){unknownIds.push(ad.item_id);continue;}
      const start=Math.max(Date.parse(campaign?.date_created),Date.parse(ad.date_created));
      members.push({itemId:ad.item_id,campaignId,campaignName:campaign?.name,active:ad.status==='active'&&campaign?.status==='active',status:ad.status==='active'&&campaign?.status!=='active'?'campaign_paused':ad.status,estimatedFrom:Number.isFinite(start)?new Date(start-3*3600000).toISOString().slice(0,10):undefined});
    }
    return {startedAt,observedAt:new Date().toISOString(),members,unknownIds};
  }
  campaignPeriods(period:{dateFrom:string;dateTo:string}){
    const key=period.dateFrom+'|'+period.dateTo;
    let plan=this.periodPlans.get(key);if(!plan){plan=this.loadCampaignPeriods(period).catch(error=>{this.periodPlans.delete(key);throw error;});this.periodPlans.set(key,plan);}return plan;
  }
  private async loadCampaignPeriods(period:{dateFrom:string;dateTo:string}){
    validateProfitPeriod(period);
    const accounts=(await this.api.get('/advertising/advertisers',{product_id:'PADS'})).advertisers?.filter((account:any)=>account.site_id==='MLB');
    if(accounts?.length!==1)throw Error('Anunciante não confirmado.');
    const advertiser=String(accounts[0].advertiser_id),base='/advertising/MLB/advertisers/'+advertiser+'/product_ads/';
    const campaigns=await this.pages(base+'campaigns/search',{}),byId=new Map(campaigns.map(campaign=>[String(campaign.id),campaign])),plans=new Map<string,any[]>();
    const day=(value:string)=>{const time=Date.parse(value);return Number.isFinite(time)?new Date(time-3*3600000).toISOString().slice(0,10):null;},today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
    for(const campaign of campaigns){
      if(String(campaign.advertiser_id)!==advertiser||!/^\d+$/.test(String(campaign.id)))throw Error('Campanha de outro anunciante.');
      const created=day(campaign.date_created),end=campaign.status==='active'?today:day(campaign.last_updated);
      if(!created||!end||created>period.dateTo||end<period.dateFrom)continue;
      const ads=await this.pages(base+'ads/search',{...this.dates(period),metrics:'cost','filters[campaign_id]':campaign.id});
      for(const ad of ads){
        if(String(ad.advertiser_id)!==advertiser||!/^MLB\d+$/.test(ad.item_id))throw Error('Anúncio de outro anunciante.');
        const adCreated=day(ad.date_created);if(!adCreated)continue;
        const from=adCreated>created?adCreated:created;let to=end;
        let note=campaign.status==='active'?'Início pela criação da campanha; histórico de pausas não fornecido.':'Fim estimado pela última atualização da campanha pausada; histórico de pausas não fornecido.';
        if(String(ad.campaign_id)!==String(campaign.id)){
          const current=byId.get(String(ad.campaign_id)),next=current&&day(current.date_created);
          if(next&&next>from&&next<=to){to=new Date(Date.parse(next)-86400000).toISOString().slice(0,10);note+=' Troca de campanha delimitada pelo início da campanha seguinte.';}
        }
        if(from>to||to<period.dateFrom||from>period.dateTo)continue;
        const list=plans.get(ad.item_id)??[];list.push({from,to,campaignId:String(campaign.id),campaignName:campaign.name,note});plans.set(ad.item_id,list);
      }
    }
    for(const ranges of plans.values()){
      ranges.sort((a,b)=>a.from.localeCompare(b.from)||a.campaignId.localeCompare(b.campaignId));
      for(let i=0;i<ranges.length-1;i++)if(ranges[i].to>=ranges[i+1].from){ranges[i].to=new Date(Date.parse(ranges[i+1].from)-86400000).toISOString().slice(0,10);ranges[i].note+=' Intervalo limitado pela campanha seguinte para evitar cobrança duplicada.';}
    }
    return plans;
  }
  async activePeriod(itemId:string){
    if(!/^MLB\d+$/.test(itemId))throw Error('Anúncio inválido.');
    const item=await this.api.get('/items/'+itemId);if(String(item.seller_id)!==this.sellerId)throw Error('Anúncio de outro vendedor.');
    const accounts=(await this.api.get('/advertising/advertisers',{product_id:'PADS'})).advertisers?.filter((account:any)=>account.site_id==='MLB');
    if(accounts?.length!==1)throw Error('Anunciante não confirmado.');
    const advertiser=String(accounts[0].advertiser_id),ads=await this.pages('/advertising/MLB/advertisers/'+advertiser+'/product_ads/ads/search',{'filters[item_id]':itemId});
    const matches=ads.filter(ad=>ad.item_id===itemId&&String(ad.advertiser_id)===advertiser);
    if(matches.length!==1||!/^\d+$/.test(String(matches[0].campaign_id)))throw Error('Campanha do anúncio não confirmada.');
    const ad=matches[0],campaign=await this.api.get('/advertising/MLB/product_ads/campaigns/'+ad.campaign_id);
    if(String(campaign.id)!==String(ad.campaign_id)||String(campaign.advertiser_id)!==advertiser)throw Error('Campanha de outro anunciante.');
    if(campaign.status!=='active'||ad.status!=='active')throw Error('Data de término da atividade não confirmada.');
    const start=Math.max(Date.parse(campaign.date_created),Date.parse(ad.date_created));
    if(!Number.isFinite(start))throw Error('Início da campanha não confirmado.');
    return {itemId,campaignId:String(campaign.id),from:new Date(start-3*3600000).toISOString().slice(0,10),to:new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),basis:'campaign_creation_to_current_date',note:'Intervalo da campanha atualmente ativa. Histórico de pausas e reativações não disponibilizado pela consulta.',checkedAt:new Date().toISOString()};
  }
  async daily(period:{dateFrom:string;dateTo:string},itemId:string){
    validateProfitPeriod(period);if(!/^MLB\d+$/.test(itemId))throw Error('Anúncio inválido.');
    const item=await this.api.get('/items/'+itemId);if(String(item.seller_id)!==this.sellerId)throw Error('Anúncio de outro vendedor.');
    const accounts=(await this.api.get('/advertising/advertisers',{product_id:'PADS'})).advertisers?.filter((account:any)=>account.site_id==='MLB');
    if(accounts?.length!==1)throw Error('Anunciante não confirmado.');
    const advertiser=String(accounts[0].advertiser_id),ads=await this.pages('/advertising/MLB/advertisers/'+advertiser+'/product_ads/ads/search',{...this.dates(period),metrics:'cost','filters[item_id]':itemId});
    const matches=ads.filter(ad=>ad.item_id===itemId);if(matches.length!==1||String(matches[0].advertiser_id)!==advertiser)throw Error('Publicidade diária não confirmada.');
    const ad=matches[0],expected=cents(ad.metrics?.cost),values:Record<string,number>={};if(expected===null)throw Error('Gasto não confirmado.');
    if(expected>0){
      if(!/^\d+$/.test(String(ad.ad_group_id)))throw Error('Grupo de publicidade não confirmado.');
      const daily=await this.api.get('/advertising/MLB/product_ads/ad_groups/'+ad.ad_group_id+'/ads',{...this.dates(period),metrics:'cost',aggregation_type:'daily','filters[item_id]':itemId});
      if(!Array.isArray(daily.results))throw Error('Série diária não confirmada.');
      for(const row of daily.results){const day=row.date,cost=cents(row.cost);if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day<period.dateFrom||day>period.dateTo||day in values||cost===null)throw Error('Série diária inválida.');values[day]=cost;}
      for(let time=Date.parse(period.dateFrom);time<=Date.parse(period.dateTo);time+=86400000)if(!(new Date(time).toISOString().slice(0,10) in values))throw Error('Série diária incompleta.');
      if(Object.values(values).reduce((sum,cost)=>sum+cost,0)!==expected)throw Error('Total diário diverge do gasto confirmado.');
    }
    return {itemId,sellerId:this.sellerId,unit:'BRL_CENTS' as const,values,coverage:[{from:period.dateFrom,to:period.dateTo}],checkedAt:new Date().toISOString()};
  }
  async total(period:{dateFrom:string;dateTo:string}){
    const report=await this.inventory(period);return {...period,cost:report.costs.reduce((sum,row)=>sum+row.costCents,0)/100,items:report.costs.length,complete:true,checkedAt:report.checkedAt};
  }
  async inventory(period:{dateFrom:string;dateTo:string}){
    validateProfitPeriod(period);
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
    if(period.dateTo>today||Date.parse(period.dateFrom)<Date.parse(today)-89*86400000)throw Error('Product Ads permite consultar somente os últimos 90 dias.');
    const accounts=(await this.api.get('/advertising/advertisers',{product_id:'PADS'})).advertisers?.filter((account:any)=>account.site_id==='MLB');
    if(accounts?.length!==1||!/^\d+$/.test(String(accounts[0].advertiser_id)))throw Error('Não foi possível identificar um único anunciante Product Ads.');
    const advertiser=String(accounts[0].advertiser_id);
    const ads=await this.pages('/advertising/MLB/advertisers/'+advertiser+'/product_ads/ads/search',{...this.dates(period),metrics:'cost'});
    const seen=new Set<string>();let total=0;
    for(const ad of ads){
      const cost=cents(ad.metrics?.cost);
      if(!/^MLB\d+$/.test(ad.item_id)||seen.has(ad.item_id)||String(ad.advertiser_id)!==advertiser||cost===null)throw Error('Total de publicidade não confirmado.');
      seen.add(ad.item_id);total+=cost;if(!Number.isSafeInteger(total))throw Error('Total de publicidade inválido.');
    }
    return {...period,sellerId:this.sellerId,complete:true,scope:'all_ads' as const,costs:ads.map(ad=>({itemId:ad.item_id,campaignId:/^\d+$/.test(String(ad.campaign_id))?String(ad.campaign_id):null,costCents:cents(ad.metrics.cost)!})),checkedAt:new Date().toISOString()};
  }
  async costs(period:{dateFrom:string;dateTo:string},itemIds:string[]){
    validateProfitPeriod(period);
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
    if(period.dateTo>today||Date.parse(period.dateFrom)<Date.parse(today)-89*86400000)throw Error('Product Ads permite consultar somente os últimos 90 dias.');
    if(!itemIds.length||itemIds.length>20||itemIds.some(id=>!/^MLB\d+$/.test(id)))throw Error('Informe até 20 anúncios válidos.');
    const advertisers=await this.api.get('/advertising/advertisers',{product_id:'PADS'});
    const accounts=advertisers.advertisers?.filter((a:any)=>a.site_id==='MLB');
    if(!Array.isArray(accounts)||accounts.length!==1||!/^\d+$/.test(String(accounts[0].advertiser_id)))throw Error('Não foi possível identificar um único anunciante Product Ads para esta conta.');
    const advertiser=String(accounts[0].advertiser_id);
    const results=[];
    for(const itemId of [...new Set(itemIds)]){
      try{
        const item=await this.api.get('/items/'+itemId);
        if(String(item.seller_id)!==this.sellerId)throw Error('Anúncio não pertence ao vendedor selecionado.');
        const ads=await this.pages('/advertising/MLB/advertisers/'+advertiser+'/product_ads/ads/search',{...this.dates(period),metrics:'cost','filters[item_id]':itemId});
        const matches=ads.filter(ad=>ad.item_id===itemId);
        if(matches.length>1)throw Error('Metricas duplicadas para o anuncio.');
        let total=0,found=false;
        for(const ad of matches){
          const cost=cents(ad.metrics?.cost);
          if(cost===null||String(ad.advertiser_id)!==advertiser)throw Error('Gasto de publicidade nao confirmado.');
          total+=cost;found=true;
        }
        if(!found)throw Error('Sem métricas de Product Ads para este anúncio no período.');
        results.push({itemId,cost:money(total),source:'Mercado Livre Product Ads',message:null});
      }catch(error){
        results.push({itemId,cost:null,source:null,message:error instanceof FinanceHttpError&&[401,403].includes(error.status)?'A conta não autorizou a leitura de Product Ads.':error instanceof FinanceHttpError?'Falha ao consultar Product Ads (HTTP '+error.status+').':(error as Error).message});
      }
    }
    return {...period,results,checkedAt:new Date().toISOString()};
  }
  private dates(period:{dateFrom:string;dateTo:string}){return {date_from:period.dateFrom,date_to:period.dateTo};}
  private async pages(path:string,params:Record<string,string>){
    const rows:any[]=[];let offset=0;
    for(let page=0;page<1000;page++){
      const value=await this.api.get(path,{...params,offset,limit:100});
      if(!Array.isArray(value.results)||!Number.isSafeInteger(value.paging?.total)||value.paging.total<0)throw Error('Paginação de Product Ads inválida.');
      rows.push(...value.results);offset+=value.results.length;
      if(offset>=value.paging.total)return rows;
      if(!value.results.length)throw Error('Consulta de Product Ads incompleta.');
    }
    throw Error('Consulta de Product Ads excedeu o limite de páginas.');
  }
}
