import { ChatPendingActionsService } from '../src/chat/chat-pending-actions.service';

describe('Durable chat confirmations',()=>{
  function setup(){
    let row:any;
    const auditLog={
      findFirst:jest.fn(async({where}:any)=>row&&['id','action','entityId','userId'].every(key=>row[key]===where[key])?structuredClone(row):null),
      create:jest.fn(async({data}:any)=>{row=structuredClone(data);return row;}),
      updateMany:jest.fn(async({where,data}:any)=>{if(!row||JSON.stringify(row.after)!==JSON.stringify(where.after.equals))return {count:0};row={...row,...structuredClone(data)};return {count:1};})
    };
    const prisma={auditLog};return {prisma,store:new ChatPendingActionsService(prisma as any)};
  }
  const action={id:'proposal',accountId:'account',userId:'user',expiresAt:Number.MAX_SAFE_INTEGER,kind:'marketplace',publication:{modelMlb:'MLB1',price:160.98,rows:[{sku:'1',color:'Amarelo',size:'P'}]}};
  it('recovers the complete payload after a server restart and keeps ownership scoped',async()=>{
    const {prisma,store}=setup();await store.save(action);
    const restarted=new ChatPendingActionsService(prisma as any);
    expect(await restarted.load('proposal','account','user')).toEqual(action);
    expect(await restarted.load('proposal','other','user')).toBeUndefined();
    expect(await restarted.load('proposal','account','other')).toBeUndefined();
  });
  it('accepts exactly one confirmation across competing server instances',async()=>{
    const {prisma,store}=setup();await store.save(action);const restarted=new ChatPendingActionsService(prisma as any);
    const results=await Promise.allSettled([store.claim('proposal','account','user','CLAIMED'),restarted.claim('proposal','account','user','CLAIMED')]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(await restarted.load('proposal','account','user')).toBeUndefined();
    await store.save(action);expect(await store.load('proposal','account','user')).toBeUndefined();
  });
  it('does not restore cancelled proposals after a restart',async()=>{
    const {prisma,store}=setup();await store.save(action);await store.claim('proposal','account','user','CANCELLED');
    expect(await new ChatPendingActionsService(prisma as any).load('proposal','account','user')).toBeUndefined();
  });
});
