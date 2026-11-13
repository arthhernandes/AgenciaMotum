import { ProductAds } from '../src/reports/product-ads';
import { assertRoutePermissions } from '../src/auth/permissions';

describe('Product Ads period costs',()=>{
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}),period={dateFrom:today,dateTo:today};
  function setup(){
    const get=jest.fn().mockImplementation(async(path:string,params:any)=>{
      if(path==='/advertising/advertisers')return {advertisers:[{advertiser_id:9,site_id:'MLB'}]};
      if(path.startsWith('/items/'))return {seller_id:7};

      if(path.endsWith('/ads/search'))return {paging:{total:2},results:params.offset===0?[{item_id:'MLB1',advertiser_id:9,metrics:{cost:10.01}}]:[{item_id:'MLB2',advertiser_id:9,metrics:{cost:0}}]};
      throw Error('Unexpected path');
    });return {get,ads:new ProductAds({get} as any,'7')};
  }
  it('reads advertiser ads directly, paginates and keeps real zero',async()=>{
    const {get,ads}=setup();const result=await ads.costs(period,['MLB1','MLB2']);
    expect(result.results.map(r=>r.cost)).toEqual([10.01,0]);
    expect(get.mock.calls.filter(c=>c[0].endsWith('/ads/search'))).toHaveLength(4);
    expect(get.mock.calls.filter(c=>c[0].endsWith('/ads/search')).map(c=>c[1]['filters[item_id]'])).toEqual(['MLB1','MLB1','MLB2','MLB2']);
    expect(get.mock.calls.some(c=>c[0].endsWith('/ad_groups/search'))).toBe(false);
    expect(get.mock.calls.every(c=>!c[0].includes('/product_ads/items'))).toBe(true);
  });
  it('does not treat missing metrics or a different seller as zero',async()=>{
    const {get,ads}=setup(),original=get.getMockImplementation()!;
    get.mockImplementation(async(path:string,params:any)=>path==='/items/MLB3'?{seller_id:8}:original(path,params));
    const result=await ads.costs(period,['MLB4','MLB3','MLB1']);
    expect(result.results.map(r=>r.cost)).toEqual([null,null,10.01]);
  });
  it('observes current links, campaign pauses and unresolved ads without interpreting them as removal',async()=>{
    const get=jest.fn().mockImplementation(async(path:string)=>{
      if(path==='/advertising/advertisers')return {advertisers:[{advertiser_id:9,site_id:'MLB'}]};
      if(path.endsWith('/campaigns/search'))return {paging:{total:1},results:[{id:11,advertiser_id:9,status:'paused',date_created:'2026-10-03T12:00:00Z'}]};
      return {paging:{total:2},results:[{item_id:'MLB1',advertiser_id:9,campaign_id:11,status:'active',date_created:'2026-01-01T12:00:00Z'},{item_id:'MLB2',advertiser_id:9,campaign_id:99,status:'active'}]};
    });
    const result=await new ProductAds({get} as any,'7').memberships();
    expect(result.members[0]).toMatchObject({itemId:'MLB1',campaignId:'11',active:false,status:'campaign_paused'});expect(result.unknownIds).toEqual(['MLB2']);
    get.mockImplementation(async(path:string)=>path==='/advertising/advertisers'?{advertisers:[{advertiser_id:9,site_id:'MLB'}]}:{paging:{total:1},results:[]});
    await expect(new ProductAds({get} as any,'7').memberships()).rejects.toThrow('incompleta');
  });
  it('uses campaign creation instead of first spending date and does not guess the end of paused campaigns',async()=>{
    let status='active';
    const get=jest.fn().mockImplementation(async(path:string)=>{
      if(path.startsWith('/items/'))return {seller_id:7};
      if(path==='/advertising/advertisers')return {advertisers:[{advertiser_id:9,site_id:'MLB'}]};
      if(path.endsWith('/ads/search'))return {paging:{total:1},results:[{item_id:'MLB1',advertiser_id:9,campaign_id:11,status:'active',date_created:'2026-02-25T12:00:00Z'}]};
      return {id:11,advertiser_id:9,status,date_created:'2026-10-03T11:39:08Z'};
    });
    const ads=new ProductAds({get} as any,'7');
    expect(await ads.activePeriod('MLB1')).toMatchObject({from:'2026-10-03',campaignId:'11',basis:'campaign_creation_to_current_date'});
    status='paused';await expect(ads.activePeriod('MLB1')).rejects.toThrow('término');
  });
  it('totals all account ads including ads with no orders and confirms zero',async()=>{
    const {get,ads}=setup();
    expect(await ads.total(period)).toMatchObject({cost:10.01,items:2,complete:true});
    const calls=get.mock.calls.filter(c=>c[0].endsWith('/ads/search'));
    expect(calls.every(c=>c[1]['filters[item_id]']===undefined)).toBe(true);
    get.mockImplementation(async(path:string)=>path==='/advertising/advertisers'?{advertisers:[{advertiser_id:9,site_id:'MLB'}]}:{paging:{total:0},results:[]});
    expect(await ads.total(period)).toMatchObject({cost:0,complete:true});
  });
  it('recovers historical campaign membership even when ad metadata points at the current campaign',async()=>{
    const get=jest.fn().mockImplementation(async(path:string,params:any)=>{
      if(path==='/advertising/advertisers')return {advertisers:[{advertiser_id:9,site_id:'MLB'}]};
      if(path.endsWith('/campaigns/search'))return {paging:{total:2},results:[
        {id:11,advertiser_id:9,status:'paused',date_created:'2026-10-03T12:00:00Z',last_updated:'2026-10-13T12:00:00Z'},
        {id:12,advertiser_id:9,status:'active',date_created:'2026-10-19T12:00:00Z'}
      ]};
      if(path.endsWith('/ads/search'))return {paging:{total:1},results:[{item_id:'MLB1',advertiser_id:9,campaign_id:12,date_created:'2025-01-01T12:00:00Z',status:params['filters[campaign_id]']===11?'idle':'active'}]};
      throw Error('Unexpected endpoint');
    });
    const ads=new ProductAds({get} as any,'7'),range={dateFrom:'2026-09-27',dateTo:'2026-10-26'};
    const result=await ads.campaignPeriods(range),windows=result.get('MLB1')!;
    expect(windows).toHaveLength(2);expect(windows[0]).toMatchObject({campaignId:'11',from:'2026-10-03',to:'2026-10-13'});
    expect(windows[0].note).toContain('estimado');expect(windows[1]).toMatchObject({campaignId:'12',from:'2026-10-19'});
    await ads.campaignPeriods(range);expect(get.mock.calls.filter(call=>call[0].endsWith('/campaigns/search'))).toHaveLength(1);
  });
  it('refuses a period total with invalid, duplicate or unconfirmed metrics',async()=>{
    const {get,ads}=setup();
    get.mockImplementation(async(path:string)=>path==='/advertising/advertisers'?{advertisers:[{advertiser_id:9,site_id:'MLB'}]}:{paging:{total:1},results:[{item_id:'MLB1',advertiser_id:8,metrics:{cost:10}}]});
    await expect(ads.total(period)).rejects.toThrow('não confirmado');
  });
  it('rejects incomplete metrics pagination and ambiguous advertisers',async()=>{
    const {get,ads}=setup(),original=get.getMockImplementation()!;
    get.mockImplementation(async(path:string,params:any)=>path.endsWith('/ads/search')?{paging:{total:1},results:[]}:original(path,params));
    expect((await ads.costs(period,['MLB1'])).results[0].cost).toBeNull();
    get.mockResolvedValue({advertisers:[{advertiser_id:9,site_id:'MLB'},{advertiser_id:10,site_id:'MLB'}]});
    await expect(ads.costs(period,['MLB1'])).rejects.toThrow('único');
  });
  it('requires report and cost visibility permissions and rejects unsupported periods',async()=>{
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['reports.view']},'GET','/api/reports/profitability/advertising')).toThrow();
    expect(()=>assertRoutePermissions({role:'VIEWER',permissions:['reports.view','costs.view']},'GET','/api/reports/profitability/advertising')).not.toThrow();
    await expect(setup().ads.costs({dateFrom:'2020-01-01',dateTo:today},['MLB1'])).rejects.toThrow();
  });
});
