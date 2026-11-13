import { groupListings } from '../src/listings/group-listings';
describe('Mercado Livre families', () => {
  it.each(['5513014842141712','Família: 5513014842141712'])('searches family ID %s and preserves its sibling offers',search=>{
    const a={...item('MLB1'),status:'active',rawData:{...item('MLB1').rawData,family_id:5513014842141712}};
    const b={...item('MLB2'),status:'paused',rawData:{...item('MLB2').rawData,family_id:'5513014842141712'}};
    const groups=groupListings([a,b,item('MLB3')],{search});
    expect(groups).toHaveLength(1);expect(groups[0].variants).toHaveLength(2);expect(groups[0].familyId).toBe('5513014842141712');
    expect(groupListings([a,b],{search,status:'closed'})).toHaveLength(0);
  });
  const offer=(id:string,status:string,date:string,up='UP-M')=>({...item(id),status,userProductId:up,rawData:{...item(id).rawData,date_created:date}});
  it.each(['under_review','inactive','closed'].flatMap(oldStatus=>['active','paused'].map(status=>({oldStatus,status}))))('hides an older $oldStatus offer after a new $status offer is added to the same UP',({oldStatus,status})=>{
    const old=offer('MLB1',oldStatus,'2026-09-21T12:00:00Z'),added=offer('MLB2',status,'2026-11-05T12:00:00Z');
    const rows=[old,added];const copy=structuredClone(rows);
    const groups=groupListings(rows);
    expect(groups[0].children.map((child:any)=>child.itemId)).toEqual(['MLB2']);expect(groups[0].variants).toHaveLength(1);expect(groups[0].status).toBe(status);
    expect(rows).toEqual(copy);
  });
  it('keeps a lone reviewed offer and never hides by color or size alone',()=>{
    const old=offer('MLB1','under_review','2026-09-21T12:00:00Z');
    expect(groupListings([old])[0].variants).toHaveLength(1);
    expect(groupListings([old,offer('MLB2','active','2026-11-05T12:00:00Z','UP-G')])[0].variants).toHaveLength(2);
  });
  it.each(['2026-08-31T12:00:00Z',''])('prioritizes the usable offer even when its creation date is older or missing: %s',date=>{
    const rows=[offer('MLB1','under_review','2026-09-14T12:00:00Z'),offer('MLB2','under_review','2026-09-14T13:00:00Z'),offer('MLB3','paused',date)];
    expect(groupListings(rows)[0].children.map((row:any)=>row.itemId)).toEqual(['MLB3']);
    expect(rows).toHaveLength(3);
  });
  it('requires an active or paused offer in the same account and family',()=>{
    const old=offer('MLB1','under_review','2026-09-21T12:00:00Z');
    for(const other of [offer('MLB2','inactive','2026-11-05T12:00:00Z'),offer('MLB2','under_review','2026-11-05T12:00:00Z'),{...offer('MLB2','active','2026-11-05T12:00:00Z'),marketplaceAccountId:'other'},{...offer('MLB2','active','2026-11-05T12:00:00Z'),rawData:{family_id:'other',date_created:'2026-11-05T12:00:00Z'}}]){
      expect(groupListings([old,other]).flatMap(group=>group.children).some(child=>child.itemId==='MLB1')).toBe(true);
    }
  });
  it('filters families with or without Full while preserving all siblings',()=>{
    const full={...item('MLB1'),rawData:{...item('MLB1').rawData,shipping:{logistic_type:'fulfillment'}}};
    const sibling=item('MLB2'),other={...item('MLB3'),rawData:{...item('MLB3').rawData,family_id:123}};
    const matching=groupListings([full,sibling,other],{full:'true'});
    expect(matching).toHaveLength(1);expect(matching[0].children).toHaveLength(2);expect(matching[0].fullCount).toBe(1);
    expect(groupListings([full,sibling,other],{full:'false'}).map(row=>row.children[0].itemId)).toEqual(['MLB3']);
    expect(groupListings([full,sibling,other])).toHaveLength(2);
  });
  it('identifies Full from logistics and distinguishes a mixed family',()=>{
    const full={...item('MLB1'),rawData:{...item('MLB1').rawData,shipping:{logistic_type:'fulfillment',tags:['self_service_in']}}};
    const regular={...item('MLB2'),rawData:{...item('MLB2').rawData,shipping:{logistic_type:'cross_docking'}}};
    expect(groupListings([full])[0]).toMatchObject({isFull:true,hasFull:true,fullCount:1,fullTotal:1});
    const mixed=groupListings([full,regular])[0];expect(mixed).toMatchObject({isFull:false,hasFull:true,fullCount:1,fullTotal:2});
    expect(mixed.variants.map((row:any)=>row.isFull)).toEqual([true,false]);
    expect(groupListings([regular,item('MLB3')])[0]).toMatchObject({hasFull:false,isFull:false,fullCount:0});
  });
  it('omits deleted offers even when Mercado Livre keeps their status inactive',()=>{
    const rows=[{...item('MLB1'),status:'active'},{...item('MLB2'),status:'inactive',rawData:{...item('MLB2').rawData,sub_status:['forbidden','deleted']}},{...item('MLB3'),status:'under_review'}];
    const groups=groupListings(rows);
    expect(groups[0].children.map((row:any)=>row.itemId)).toEqual(['MLB1','MLB3']);
    expect(groups[0].variants).toHaveLength(2);
    expect(groupListings(rows,{search:'MLB2'})).toHaveLength(0);
  });
  const item = (itemId: string, account = 'mottum') => ({ id: itemId, itemId, marketplaceAccountId: account, title: itemId, price: 100, availableQuantity: 2, soldQuantity: 1, variants: [], links: [], rawData: { family_id: 831287482247697, family_name: 'Jaqueta Caqui', attributes: [{ id: 'SIZE', value_name: itemId }] } });
  it('groups separate MLBs with the same family and preserves children', () => {
    const groups = groupListings([item('MLB4718891551'), item('MLB4718900301')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(2);
    expect(groups[0].availableQuantity).toBe(4);
  });
  it('keeps accounts separate and retains siblings when searching one MLB', () => {
    const groups = groupListings([item('MLB1'), item('MLB2'), item('MLB3','outlet4u')], { search: 'MLB1' });
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(2);
  });
});
