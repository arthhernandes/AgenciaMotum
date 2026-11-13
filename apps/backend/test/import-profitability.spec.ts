import { ProfitabilityEngine } from '../src/reports/profitability-engine';
import { FinanceHttpError } from '../src/reports/finance-api';
import { assertRoutePermissions } from '../src/auth/permissions';
import { ImportCostsQuery, ImportAdvertisingQuery } from '../src/reports/profitability.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('Import missing profitability costs',()=>{
  it('accepts the account from the URL without requiring it in the import body',async()=>{
    const period={dateFrom:'2026-10-22',dateTo:'2026-10-23'};
    expect(await validate(plainToInstance(ImportCostsQuery,{...period,offset:0,limit:10}))).toEqual([]);
    expect(await validate(plainToInstance(ImportAdvertisingQuery,{...period,itemIds:'MLB3862551921'}))).toEqual([]);
  });
  it.each(['import-costs','import-advertising','import-advertising-summary'])('requires report and cost permissions for %s',route=>{
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['reports.view']},'POST','/api/reports/profitability/'+route)).toThrow();
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['reports.view','costs.view']},'POST','/api/reports/profitability/'+route)).not.toThrow();
  });
  const row={orderId:'1',itemIndex:0,itemId:'MLB1',sku:'SKU1',quantity:2,unitPrice:100,revenue:200,commission:20,sellerShipping:10,fiscalCost:null,invoiceTaxes:null,status:'paid',currency:'BRL',issues:['Custo fiscal não confirmado']};
  it('fills missing fiscal cost by quantity and preserves confirmed shipping',async()=>{
    const get=jest.fn().mockResolvedValue({seller_id:7,sku:'SKU1',cost:30});
    const result=await new ProfitabilityEngine({get} as any,'7').fillMissingCosts(row);
    expect(result).toMatchObject({fiscalCost:60,sellerShipping:10,profitBeforeTaxes:110,issues:[]});
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/items/fiscal_information/SKU1');
  });
  it('preserves confirmed costs including zero without external requests',async()=>{
    const get=jest.fn();
    expect(await new ProfitabilityEngine({get} as any,'7').fillMissingCosts({...row,fiscalCost:0})).toMatchObject({fiscalCost:0,sellerShipping:10});
    expect(get).not.toHaveBeenCalled();
  });
  it('keeps unavailable costs pending when the fiscal seller does not match',async()=>{
    const get=jest.fn().mockResolvedValue({seller_id:8,sku:'SKU1',cost:30});
    expect(await new ProfitabilityEngine({get} as any,'7').fillMissingCosts(row)).toMatchObject({fiscalCost:null,profitBeforeTaxes:null,issues:row.issues});
  });
  it('recovers the SKU and cost from fiscal information linked to the item',async()=>{
    const get=jest.fn().mockImplementation(async(path:string)=>path.endsWith('/detail')?{item_id:'MLB1',seller_id:'7',sku:{seller_id:'7',sku:'FISCAL1',cost:25}}:{seller_id:7,attributes:[]});
    expect(await new ProfitabilityEngine({get} as any,'7').fillMissingCosts({...row,sku:null})).toMatchObject({sku:'FISCAL1',fiscalCost:50,issues:[]});
  });
  it('explains an item without SKU or linked fiscal information',async()=>{
    const get=jest.fn().mockImplementation(async(path:string)=>{if(path.endsWith('/detail'))throw new FinanceHttpError(404,path);return {seller_id:7,attributes:[]};});
    const result=await new ProfitabilityEngine({get} as any,'7').fillMissingCosts({...row,sku:null});
    expect(result.fiscalCost).toBeNull();expect(result.issues).toEqual(['Anúncio sem SKU e sem cadastro fiscal vinculado no Mercado Livre.']);
  });
});
