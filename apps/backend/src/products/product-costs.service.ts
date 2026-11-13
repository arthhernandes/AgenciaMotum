import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlingSyncService } from '../bling/synchronization/bling-sync.service';

@Injectable()
export class ProductCostsService {
  private readonly loading=new Map<string,Promise<any>>();
  constructor(private readonly prisma:PrismaService,private readonly bling:BlingSyncService){}
  async find(accountId:string,productId:string,refresh=false){
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id:accountId,marketplace:'BLING',active:true},select:{id:true}});
    if(!account)throw new BadRequestException('Selecione uma conta Bling válida.');
    const product=await this.prisma.product.findFirst({where:{id:productId,blingAccountId:account.id},include:{variants:{select:{sku:true}}}});
    if(!product)throw new NotFoundException('Produto não encontrado nesta conta.');
    const id=`bling-costs:${product.id}`;
    const saved=await this.prisma.auditLog.findFirst({where:{id,action:'BLING_PRODUCT_COSTS',entityId:product.id}});
    const cache=saved?.after as any;
    const sameSkus=cache?.rows?.length===product.variants.length&&product.variants.every(variant=>cache.rows.some((row:any)=>row.sku===variant.sku));
    if(!refresh&&sameSkus&&Date.now()-Date.parse(cache.checkedAt)<15*60_000)return {...cache,cached:true};
    const pending=this.loading.get(id);if(pending)return pending;
    const operation=this.fetch(id,account.id,product,cache);this.loading.set(id,operation);
    try{return await operation;}finally{this.loading.delete(id);}
  }
  private async fetch(id:string,accountId:string,product:any,previous:any){
    let rows:any[];
    try{rows=await this.bling.productCostsForParent(accountId,product.blingProductId,product.sku,product.variants.map((variant:any)=>variant.sku));}
    catch{
      rows=product.variants.map((variant:any)=>{
        const old=previous?.rows?.find((row:any)=>row.sku===variant.sku);
        return {sku:variant.sku,cost:old?.cost??null,checkedAt:old?.checkedAt??null,stale:true,source:'Bling',message:old?.cost!=null?'Falha ao atualizar; exibindo o último custo consultado.':'Não foi possível consultar este custo. Confira a conexão Bling.'};
      });
    }
    const result={accountId,productId:product.id,rows,checkedAt:new Date().toISOString()};
    await this.prisma.auditLog.upsert({where:{id},create:{id,action:'BLING_PRODUCT_COSTS',entityType:'Product',entityId:product.id,after:result},update:{after:result}});
    return {...result,cached:false};
  }
}
