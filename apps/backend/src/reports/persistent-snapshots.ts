import { PrismaService } from '../prisma/prisma.service';

/** No credentials or buyer payloads: only sanitized report/metric values. */
export class PersistentSnapshots {
  constructor(private prisma:PrismaService){}
  async get(account:string,category:string,key:string){
    const record=await this.prisma.integrationSnapshot.findUnique({where:{marketplaceAccountId_category_key:{marketplaceAccountId:account,category,key}}});
    return record&&(!record.expiresAt||record.expiresAt.getTime()>Date.now())?record:null;
  }
  async put(account:string,category:string,key:string,payload:unknown,fetchedAt=new Date(),ttlMs?:number){
    const values={payload:JSON.parse(JSON.stringify(payload)),fetchedAt,expiresAt:ttlMs===undefined?null:new Date(Date.now()+ttlMs)};
    return this.prisma.integrationSnapshot.upsert({where:{marketplaceAccountId_category_key:{marketplaceAccountId:account,category,key}},create:{marketplaceAccountId:account,category,key,...values},update:values});
  }
}
