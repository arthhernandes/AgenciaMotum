import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, Optional, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertListingWritable, listingWriteBlock, FINALIZED_MESSAGE, PUBLICATION_BLOCK_CATEGORY } from '../listings/listing-write-block';
import { firstValueFrom } from 'rxjs';
import { sizeChartName } from './size-chart-name';
import { sellerSku } from './synchronization/seller-sku';

export interface MeliSearchResponse {
  scroll_id?: string;
  seller_id: string;
  results: string[];
  paging: { total: number; offset: number; limit: number };
}

export interface MeliItemResponse {
  id: string;
  site_id?:string;
  domain_id?:string;
  seller_id?: number;
  currency_id?: string;
  category_id?: string;
  condition?: string;
  family_name?: string;
  family_id?: string | number;
  date_created?:string;
  last_updated?: string;
  original_price?: number | null;
  tags?: string[];
  shipping?: { logistic_type?: string; mode?: string };
  pictures?: Array<{ id: string; url?: string; secure_url?: string }>;
  attributes?: Array<{ id: string; value_name?: string | null; value_id?: string | null }>;
  sale_terms?: Array<{ id: string; value_name?: string | null; value_id?: string | null }>;
  title?: string;
  status?: string;
  sub_status?: string[];
  listing_type_id?: string;
  catalog_product_id?: string;
  price?: number;
  available_quantity?: number;
  sold_quantity?: number;
  permalink?: string;
  user_product_id?: string;
  variations?: MeliVariationResponse[];
  seller_custom_field?: string;
}

export interface MeliVariationResponse {
  id: number | string;
  available_quantity?: number;
  sold_quantity?: number;
  seller_custom_field?: string;
  user_product_id?: string;
  attribute_combinations?: unknown[];
  attributes?: unknown[];
  price?: number;
  picture_ids?: string[];
}

@Injectable()
export class MercadoLivreClient {
  private readonly logger = new Logger(MercadoLivreClient.name);
  private readonly baseUrl = 'https://api.mercadolibre.com';

  constructor(private readonly http: HttpService,@Optional() private readonly prisma?:PrismaService) {}

  private async writableResource(path:string,token:string){
    if(!this.prisma)return undefined;
    let resource:any;
    const item=/^(?:\/items\/|\/pricing-automation\/items\/)(ML[A-Z]\d+)(?:\/|$)/.exec(path),up=/^\/user-products\/([^/]+)/.exec(path),family=/^\/user-products-families\/([^/]+)/.exec(path);
    if(item)resource=await this.getItem(token,item[1]);
    else if(up)resource=await this.getUserProduct(token,decodeURIComponent(up[1]));
    else if(family)resource=await this.getUserProductFamily(token,decodeURIComponent(family[1]));
    if(!resource)return undefined;
    const accounts=await this.prisma.marketplaceAccount.findMany({where:{marketplace:'MERCADO_LIVRE',sellerId:String(resource.seller_id??resource.user_id)},select:{id:true}});
    for(const account of accounts){
      await assertListingWritable(this.prisma,account.id,{...resource,user_product_id:item?resource.user_product_id:up?resource.id:undefined});
      if(!item&&resource.family_id){const siblings=await this.prisma.marketplaceListing.findMany({where:{marketplaceAccountId:account.id,rawData:{path:['family_id'],equals:resource.family_id}},select:{status:true,rawData:true}});if(siblings.length&&siblings.every(row=>!!listingWriteBlock(row)))throw new BadRequestException(FINALIZED_MESSAGE);}
    }
    return {accounts,resource,upId:item?resource.user_product_id:up?resource.id:undefined};
  }

  async getItemVisits(accessToken:string,ids:string[],period?:{dateFrom:string;dateTo:string}){
    if(ids.length!==1||!/^MLB\d+$/.test(ids[0]))throw new Error('Consulte as visitas de um anúncio por vez.');
    const url=period?'https://api.mercadolibre.com/items/visits':'https://api.mercadolibre.com/items/'+ids[0]+'/visits/time_window';
    const params=period?{ids:ids[0],date_from:period.dateFrom,date_to:period.dateTo}:{last:30,unit:'day'};
    const response=await firstValueFrom(this.http.get<any>(url,{params,headers:{Authorization:'Bearer '+accessToken},timeout:15000}));
    return Array.isArray(response.data)?response.data:[response.data];
  }

  async uploadPicture(accessToken:string,buffer:Buffer,mimetype:string){
    const form=new FormData();
    form.append('file',new Blob([Uint8Array.from(buffer)],{type:mimetype}),mimetype==='image/png'?'foto.png':'foto.jpg');
    const response=await firstValueFrom(this.http.post<any>(this.baseUrl+'/pictures/items/upload',form,{headers:{Authorization:'Bearer '+accessToken},timeout:60000,maxBodyLength:11*1024*1024,maxContentLength:1024*1024}));
    return response.data;
  }
  async searchSellerItems(accessToken: string, sellerId: string, params: { status?: string; offset?: number; limit?: number; search_type?: string; scroll_id?: string } = {}) {
    return this.get<MeliSearchResponse>(`/users/${sellerId}/items/search`, accessToken, params);
  }

  async getItem(accessToken: string, itemId: string) {
    return this.get<MeliItemResponse>(`/items/${itemId}`, accessToken, {include_attributes:'all'});
  }
  async getItemModerations(accessToken:string,sellerId:string,itemId:string){
    return this.get<{infractions?:Array<{related_item_id?:string;reason?:string;remedy?:string}>}>(`/moderations/infractions/${sellerId}`,accessToken,{related_item_id:itemId,language:'PT',limit:20});
  }

  async getSeller(accessToken: string, sellerId: string) {
    return this.get<{ id: number; tags?: string[] }>(`/users/${encodeURIComponent(sellerId)}`, accessToken);
  }

  async getAuthenticatedSeller(accessToken:string) {
    const response = await firstValueFrom(this.http.get<{id:number}>(`${this.baseUrl}/users/me`,{headers:{Authorization:`Bearer ${accessToken}`},timeout:8000}));
    return response.data;
  }

  async getUserProduct(accessToken: string, productId: string) {
    return this.get<any>(`/user-products/${encodeURIComponent(productId)}`,accessToken);
  }

  async getSizeChart(accessToken:string,chartId:string){return this.get<any>(`/catalog/charts/${encodeURIComponent(chartId)}`,accessToken);}
  async getSizeChartDomains(accessToken:string){return this.get<{domains:Array<{domain_id:string}>}>('/catalog/charts/MLB/configurations/active_domains',accessToken);}
  async searchSizeCharts(accessToken:string,body:Record<string,unknown>,offset=0){
    const response=await firstValueFrom(this.http.post<any>(`${this.baseUrl}/catalog/charts/search`,body,{params:{offset,limit:100},headers:{Authorization:`Bearer ${accessToken}`},timeout:20000}));return response.data;
  }
  async getSizeChartSpecs(accessToken:string,domain:string,attributes:any[]){
    const response=await firstValueFrom(this.http.post<any>(`${this.baseUrl}/domains/${encodeURIComponent(domain)}/technical_specs`,{type:'SPECIFIC',attributes},{params:{section:'grids'},headers:{Authorization:`Bearer ${accessToken}`},timeout:20000}));return response.data;
  }
  async createSizeChart(accessToken:string,productName:string,body:Record<string,unknown>){return this.write<any>('post','/catalog/charts',accessToken,{...body,names:{MLB:sizeChartName(productName)}});}
  async updateFamilyVariants(accessToken:string,familyId:string,userProducts:any[]){return this.write<any>('put',`/user-products-families/${encodeURIComponent(familyId)}/user-products`,accessToken,{user_products:userProducts});}
  async getFamilyTask(accessToken:string,taskId:string){return this.get<any>(`/user-products-families/tasks/${encodeURIComponent(taskId)}`,accessToken);}

  async getUserProductFamily(accessToken: string, familyId: string) {
    return this.get<any>(`/user-products-families/${encodeURIComponent(familyId)}`,accessToken);
  }
  async updateUserProductFamily(accessToken:string,familyId:string,body:Record<string,unknown>){return this.write<any>('put',`/user-products-families/${encodeURIComponent(familyId)}`,accessToken,body);}
  async getCategoryAttributeDefinitions(accessToken:string,categoryId:string){return this.get<any[]>(`/categories/${encodeURIComponent(categoryId)}/attributes`,accessToken);}

  async getFamilyUserProducts(accessToken: string, familyId: string) {
    return this.get<{family_id:string|number;user_products_ids:string[]}>(`/user-products-families/${encodeURIComponent(familyId)}/user-products`,accessToken);
  }

  async addFamilyUserProduct(accessToken: string, familyId: string, data: Record<string,unknown>) {
    return this.write<any>('post',`/user-products-families/${encodeURIComponent(familyId)}/user-products`,accessToken,data);
  }

  async getProductStock(accessToken:string,productId:string) {
    try {
      const response=await firstValueFrom(this.http.get<any>(`${this.baseUrl}/user-products/${encodeURIComponent(productId)}/stock`,{headers:{Authorization:`Bearer ${accessToken}`},timeout:20000}));
      return {data:response.data,version:String(response.headers['x-version'] ?? '')};
    } catch (error) {
      if ((error as any)?.response?.status===404 && (error as any)?.response?.data?.message==='stock-locations not found') return null;
      throw error;
    }
  }

  async initializeWarehouseStock(accessToken:string,productId:string,location:Record<string,unknown>) {
    // An absent stock resource starts at version zero. The conditional PUT
    // initializes its location and prevents a repeated creation from winning.
    return this.updateWarehouseStock(accessToken,productId,[location],'0');
  }

  async updateWarehouseStock(accessToken:string,productId:string,locations:any[],version:string) {
    await this.writableResource('/user-products/'+encodeURIComponent(productId)+'/stock',accessToken);
    if (!version) throw new Error('Missing stock version');
    const response=await firstValueFrom(this.http.put<any>(`${this.baseUrl}/user-products/${encodeURIComponent(productId)}/stock/type/seller_warehouse`,{locations},{headers:{Authorization:`Bearer ${accessToken}`,'x-version':version},timeout:20000}));
    return response.data;
  }

  async createUserProductOffer(accessToken:string,productId:string,body:Record<string,unknown>) {
    return this.write<MeliItemResponse>('post',`/user-products/${encodeURIComponent(productId)}/items`,accessToken,body);
  }

  async getWarehouses(accessToken:string,sellerId:string) {
    const rows:any[]=[];let offset=0;
    while(true) {
      const page=await this.get<any>(`/users/${encodeURIComponent(sellerId)}/stores/search`,accessToken,{tags:'stock_location',limit:50,offset});
      rows.push(...page.results);offset+=page.results.length;
      if(offset>=page.paging.total)return rows;
      if(!page.results.length)throw new Error('Incomplete warehouse search');
    }
  }

  async searchUserProductOffers(accessToken:string,sellerId:string,productId:string) {
    const results:string[]=[];let offset=0;
    while(true) {
      const page=await this.get<MeliSearchResponse>(`/users/${encodeURIComponent(sellerId)}/items/search`,accessToken,{user_product_id:productId,limit:50,offset});
      results.push(...page.results);offset+=page.results.length;
      if(offset>=page.paging.total)return results;
      if(!page.results.length)throw new Error('Incomplete offer search');
    }
  }

  async getDescription(accessToken: string, itemId: string) {
    try {
      return await this.get<{ plain_text: string }>(`/items/${itemId}/description`, accessToken);
    } catch (error) {
      if ((error as any)?.response?.status === 404) return null;
      throw error;
    }
  }

  async getPriceAutomation(accessToken: string, itemId: string, strict=false) {
    try {
      // A single request: an absent automation is an expected response.
      const response = await firstValueFrom(this.http.get<{ status: string;item_id?:string;item_rule?:{rule_id:string};min_price?:number;max_price?:number }>(`${this.baseUrl}/pricing-automation/items/${itemId}/automation`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      }));
      return response.data;
    } catch (error) {
      const response = (error as any)?.response;
      if (response?.status === 404 && response.data?.error === 'automation_not_found') return null;
      if (!strict&&response?.status === 412 && response.data?.error === 'user_not_authorized') return null;
      throw error;
    }
  }
  async getSellerPriceAutomationItems(accessToken:string,sellerId:string){
    const ids:string[]=[];let offset=0;
    for(let pageNumber=0;pageNumber<100;pageNumber++){
      const page=await this.get<{items:string[];paging:{total:number;offset:number;limit:number}}>(`/pricing-automation/users/${encodeURIComponent(sellerId)}/items`,accessToken,{offset,limit:100});
      if(!Array.isArray(page.items)||!Number.isInteger(page.paging?.total)||page.items.some(id=>typeof id!=='string'||!/^ML[BAMCU]\d+$/.test(id)))throw new Error('Invalid automation listing');
      ids.push(...page.items);offset+=page.items.length;
      if(offset>=page.paging.total)return [...new Set(ids)];
      if(!page.items.length)throw new Error('Incomplete automation listing');
    }
    throw new Error('Automation listing exceeds foreground limit');
  }
  async removePriceAutomation(accessToken:string,itemId:string){
    try{return await this.write<any>('delete',`/pricing-automation/items/${itemId}/automation`,accessToken,{});}
    catch(error){if((error as any)?.response?.status===404&&(error as any)?.response?.data?.error==='automation_not_found')return;throw error;}
  }

  async category(accessToken: string, categoryId: string) {
    const [category, attributes] = await Promise.all([
      this.get<any>(`/categories/${categoryId}`, accessToken),
      this.get<any[]>(`/categories/${categoryId}/attributes`, accessToken)
    ]);
    return { category, attributes };
  }
  async predictCategories(accessToken:string,title:string){return this.get<any[]>('/sites/MLB/domain_discovery/search',accessToken,{q:title,limit:3});}

  async updateItem(accessToken: string, itemId: string, data: Record<string, unknown>) {
    const skuUpdate=Object.keys(data).every(key=>['attributes','variations'].includes(key))&&
      (!!sellerSku(data)||(data.variations as any[])?.some(row=>sellerSku(row)));
    if(!skuUpdate)return this.write<MeliItemResponse>('put', `/items/${itemId}`, accessToken, data);
    for(let attempt=0;;attempt++){
      const wait=Math.max(0,this.nextSkuWriteAt-Date.now());this.nextSkuWriteAt=Date.now()+wait+1200;
      if(wait)await this.skuPause(wait);
      try{return await this.write<MeliItemResponse>('put', `/items/${itemId}`, accessToken, data);}
      catch(error){
        // Only a definitive rate-limit rejection is retried; timeouts remain uncertain.
        if((error as any)?.response?.status!==429||attempt>=3)throw error;
        const after=(error as any).response.headers?.['retry-after'],seconds=Number(after);
        const delay=Number.isFinite(seconds)&&seconds>0?seconds*1000:Date.parse(after??'')-Date.now();
        await this.skuPause(Math.min(30000,Math.max(2000*(attempt+1),Number.isFinite(delay)?delay:0)));
        const current=await this.getItem(accessToken,itemId);
        const expected=sellerSku(data),variations=data.variations as any[]|undefined;
        if((!expected||sellerSku(current)===expected)&&(!variations||variations.every(row=>!sellerSku(row)||sellerSku(current.variations?.find(value=>String(value.id)===String(row.id)))===sellerSku(row))))return current;
      }
    }
  }
  private nextSkuWriteAt=0;
  private skuPause(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms));}
  async getItemPrices(accessToken:string,itemId:string){return this.get<any>(`/items/${itemId}/prices`,accessToken);}
  async getFiscalTaxRule(accessToken:string,sellerId:string,id:number){return this.get<any>(`/users/${sellerId}/invoices/tax_rules/${id}`,accessToken);}
  async getFiscalTaxRules(accessToken:string,sellerId:string,offset=0){return this.get<any>(`/users/${sellerId}/invoices/tax_rules`,accessToken,{offset,limit:50});}
  async getFiscalBySku(accessToken:string,sku:string){
    try{return await this.get<any>(`/items/fiscal_information/${encodeURIComponent(sku)}`,accessToken);}
    catch(error){const response=(error as any)?.response;if(response?.status===404&&(/^Sku not found by sku:/i.test(response.data?.message??'')||['404 NOT_FOUND','404_NOT_FOUND'].includes(response.data?.error_code)))return null;throw error;}
  }
  async getFiscalByItem(accessToken:string,itemId:string){return this.get<any>(`/items/${itemId}/fiscal_information/detail`,accessToken);}
  async canInvoice(accessToken:string,itemId:string,variationId?:string){return this.get<any>(`/can_invoice/items/${itemId}${variationId?`/variations/${encodeURIComponent(variationId)}`:''}`,accessToken);}
  async createFiscal(accessToken:string,data:Record<string,unknown>){return this.write<any>('post','/items/fiscal_information',accessToken,data);}
  async updateFiscal(accessToken:string,sku:string,data:Record<string,unknown>){return this.write<any>('put',`/items/fiscal_information/${encodeURIComponent(sku)}`,accessToken,data);}
  async bindFiscal(accessToken:string,sku:string,itemId:string,variationId?:string){return this.write<any>('post','/items/fiscal_information/items',accessToken,{sku,item_id:itemId,variation_id:variationId??''});}
  async updateStandardPrices(accessToken:string,itemId:string,prices:Array<{amount:number;currency_id:string;conditions:{context_restrictions:string[]}}>){
    return this.write<any>('post',`/items/${itemId}/prices/standard`,accessToken,{prices});
  }

  async setDescription(accessToken: string, itemId: string, text: string, exists: boolean) {
    return this.write(exists ? 'put' : 'post', `/items/${itemId}/description`, accessToken, { plain_text: text });
  }
  async deleteVariation(accessToken:string,itemId:string,variationId:string){return this.write<any>('delete',`/items/${itemId}/variations/${variationId}`,accessToken,{});}

  async validateItem(accessToken: string, data: Record<string, unknown>) {
    return this.write<any>('post', '/items/validate', accessToken, data);
  }

  async createItem(accessToken: string, data: Record<string, unknown>) {
    return this.write<MeliItemResponse>('post', '/items', accessToken, data);
  }

  private async write<T>(method: 'put' | 'post'|'delete', path: string, accessToken: string, data: Record<string, unknown>): Promise<T> {
    const context=await this.writableResource(path,accessToken);
    // Never retry writes automatically: a timeout can happen after ML applied a change.
    try{
      const config={headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type':'application/json', Accept:'application/json' }, timeout: 20000};
      const response = await firstValueFrom(method==='delete'?this.http.delete<T>(`${this.baseUrl}${path}`,config):this.http[method]<T>(`${this.baseUrl}${path}`,data,config));
      return response.data;
    }catch(error){
      if(this.prisma&&context?.upId&&(error as any)?.response?.data?.cause?.some((cause:any)=>cause.code==='seller.optin.fake')){
        for(const account of context.accounts){try{const key=context.upId,payload={code:'seller.optin.fake',familyId:String(context.resource.family_id),reason:FINALIZED_MESSAGE};await this.prisma.integrationSnapshot.upsert({where:{marketplaceAccountId_category_key:{marketplaceAccountId:account.id,category:PUBLICATION_BLOCK_CATEGORY,key}},create:{marketplaceAccountId:account.id,category:PUBLICATION_BLOCK_CATEGORY,key,payload,fetchedAt:new Date()},update:{payload,fetchedAt:new Date(),expiresAt:null}});}catch{this.logger.warn('Não foi possível registrar o bloqueio definitivo da publicação.');}}
      }
      const status=(error as any)?.response?.status;
      const code=(error as any)?.code;
      this.logger.warn(`Mercado Livre write failed method=${method.toUpperCase()} path=${path} status=${Number.isInteger(status)?status:'none'} code=${typeof code==='string'&&/^[A-Z0-9_]{1,40}$/.test(code)?code:'unknown'}`);
      throw error;
    }
  }

  async getItems(accessToken: string, itemIds: string[]) {
    const chunks = this.chunk(itemIds, 20);
    const responses: Array<{ code: number; body: MeliItemResponse }> = [];
    for (const ids of chunks) {
      try{
        const result=await this.get<any[]>('/items/bulk', accessToken, { ids: ids.join(','), include_attributes: 'all' });
        if(!Array.isArray(result)||result.length!==ids.length)throw new Error('Mercado Livre returned an incomplete item batch.');
        responses.push(...result.map((row,index)=>{
          const body=row.body??row,status=Number(row.code??row.status??row.status_code??body.status);
          const code=Number.isInteger(status)&&status>=100&&status<=599?status:body.id?200:502;
          return {code,body:{...body,id:body.id??ids[index]} as MeliItemResponse};
        }));
      }
      catch(error){
        const response=(error as any)?.response;
        if(response?.status!==403||response.data?.error!=='ResourceDeprecated')throw error;
        this.logger.warn('Mercado Livre batch resource deprecated; checking the same item IDs individually.');
        const individual:Array<{code:number;body:MeliItemResponse}>=[];
        for(const id of ids){
          try{individual.push({code:200,body:await this.getItem(accessToken,id)});}
          catch(failure){const status=(failure as any)?.response?.status;if(![403,404,410,500,502,503,504].includes(status))throw failure;individual.push({code:status,body:{id} as MeliItemResponse});}
        }
        if(individual.every(row=>row.code===403))throw error;
        responses.push(...individual);
      }
    }
    return responses;
  }

  private async get<T>(path: string, accessToken: string, params?: Record<string, string | number | undefined>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await firstValueFrom(this.http.get<T>(`${this.baseUrl}${path}`, {
          params,
          timeout: 60000,
          headers: { Authorization: `Bearer ${accessToken}` }
        }));
        return response.data;
      } catch (error) {
        lastError = error;
        const status=(error as any)?.response?.status;
        const code=(error as any)?.code;
        this.logger.warn(`Mercado Livre request failed path=${path} attempt=${attempt} status=${Number.isInteger(status)?status:'none'} code=${typeof code==='string'&&/^[A-Z0-9_]{1,40}$/.test(code)?code:'unknown'}`);
        if ([400,401,403,404].includes(status)) throw error;
        const retryAfter=(error as any)?.response?.headers?.['retry-after'];
        const seconds=Number(retryAfter);
        const delay=status===429 ? Number.isFinite(seconds)&&seconds>0 ? seconds*1000 : Math.max(1000,Date.parse(retryAfter)-Date.now() || attempt*2000) : attempt*250;
        if (attempt<3) await new Promise((resolve) => setTimeout(resolve,delay));
      }
    }
    throw lastError;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
  }
}
