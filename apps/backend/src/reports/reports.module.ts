import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ReportQuery } from './reports.dto';
import { AdvertisingQuery, ProfitabilityQuery, ProfitabilityService, SaveProfitabilityInputs, ImportCostsQuery, ImportAdvertisingQuery, RefreshReportListingQuery } from './profitability.service';
import { MercadoLivreModule } from '../mercadolivre/mercadolivre.module';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ListingsModule } from '../listings/listings.module';
import { ListingsService } from '../listings/listings.service';
import { groupListings } from '../listings/group-listings';
import { reportFamilies } from './report-families';
import { PrismaService } from '../prisma/prisma.service';
import { AdvertisingTrackerModule } from './advertising-tracker.module';

@Injectable()
export class ReportsService {
  constructor(private prisma:PrismaService,private listings:ListingsService){}
  async overview(query:ReportQuery){
    const account=await this.prisma.marketplaceAccount.findFirst({where:{id:query.marketplaceAccountId,active:true},select:{id:true,businessKey:true,name:true}});
    if(!account)throw new BadRequestException('Selecione uma conta válida.');
    if(query.dateFrom||query.dateTo){
      const valid=(d?:string)=>!!d&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
      if(!valid(query.dateFrom)||!valid(query.dateTo)||query.dateFrom!>query.dateTo!)throw new BadRequestException('Informe um período válido.');
    }
    const catalog=await this.listings.findAll({page:1,limit:50,marketplaceAccountId:account.id},true);
    const accounts=await this.prisma.marketplaceAccount.findMany({where:{businessKey:account.businessKey,marketplace:'BLING'},select:{id:true}});
    const products=await this.prisma.product.findMany({where:{blingAccountId:{in:accounts.map(a=>a.id)}},select:{id:true,sku:true,title:true,variants:{select:{sku:true}}}});
    const groups=reportFamilies(groupListings(catalog.data),products,account.businessKey),offers=groups.flatMap(g=>g.children);
    const parents=groups.flatMap(g=>g.parentListings);
    const statuses:Record<string,number>={};for(const item of parents)statuses[item.status]=(statuses[item.status]??0)+1;
    return {generatedAt:new Date().toISOString(),account:account.name,
      listings:{summary:{families:groups.length,offers:parents.length,units:offers.reduce((sum,r)=>sum+r.availableQuantity,0),sold:offers.reduce((sum,r)=>sum+r.soldQuantity,0),statuses},
        rows:groups.map(g=>({id:g.id,title:g.title,baseSku:g.baseSku,parentCount:g.parentCount,itemIds:g.children.map((c:any)=>c.itemId),status:g.status,variants:g.variants.length,stock:g.availableQuantity,sold:g.soldQuantity,price:Number(g.price),maxPrice:Number(g.maxPrice)}))}};
  }
}
@Controller('reports') @UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private service:ReportsService,private profitability:ProfitabilityService){}
  @Get('profitability/enrichment-status') enrichmentStatus(){return this.profitability.enrichmentStatus();}
  @Get('profitability/listing-parents') listingParents(@Query() query:AdvertisingQuery){return this.profitability.listingParents(query);}
  @Post('profitability/refresh-listing') refreshListing(@Query() query:ReportQuery,@Body() body:RefreshReportListingQuery){return this.profitability.refreshListing({...body,marketplaceAccountId:query.marketplaceAccountId});}
  @Get('profitability/advertising-summary') advertisingSummary(@Query() query:ReportQuery){return this.profitability.advertisingSummary(query);}
  @Get('profitability/advertising-allocation') advertisingAllocation(@Query() query:ReportQuery){return this.profitability.advertisingAllocation(query);}
  @Post('profitability/import-advertising-allocation') importAdvertisingAllocation(@Query() query:ReportQuery,@Body() body:ImportCostsQuery){return this.profitability.importAdvertisingAllocation({...body,marketplaceAccountId:query.marketplaceAccountId});}
  @Post('profitability/import-advertising-summary') importAdvertisingSummary(@Query() query:ReportQuery,@Body() body:ImportCostsQuery){return this.profitability.importAdvertisingSummary({...body,marketplaceAccountId:query.marketplaceAccountId});}
  @Post('profitability/import-costs') importCosts(@Query() query:ReportQuery,@Body() body:ImportCostsQuery){return this.profitability.importCosts({...body,marketplaceAccountId:query.marketplaceAccountId});}
  @Post('profitability/import-advertising') importAdvertising(@Query() query:ReportQuery,@Body() body:ImportAdvertisingQuery){return this.profitability.importAdvertising({...body,marketplaceAccountId:query.marketplaceAccountId});}
  @Get('profitability/inputs') inputs(@Query() query:ReportQuery){return this.profitability.inputs(query);}
  @Post('profitability/inputs') saveInputs(@Query() query:ReportQuery,@Body() body:SaveProfitabilityInputs,@Req() req:any){return this.profitability.saveInputs(query,body,req.user.id);}
  @Get('profitability/advertising') advertising(@Query() query:AdvertisingQuery){return this.profitability.advertising(query);}
  @Get('profitability') profitabilityPage(@Query() query:ProfitabilityQuery){return this.profitability.page(query);}
  @Get() overview(@Query() query:ReportQuery){return this.service.overview(query);}
}
@Module({imports:[ListingsModule,MercadoLivreModule,AdvertisingTrackerModule],controllers:[ReportsController],providers:[ReportsService,ProfitabilityService]})
export class ReportsModule {}
