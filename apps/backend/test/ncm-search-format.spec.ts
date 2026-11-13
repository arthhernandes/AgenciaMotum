import {NcmController} from '../src/ncm/ncm.module';
describe('NCM numeric search formatting',()=>{
 const run=async(search:string)=>{
  const prisma:any={ncmEntry:{findMany:jest.fn().mockResolvedValue([]),count:jest.fn().mockResolvedValue(0)}};
  await new NcmController(prisma).search(search);
  return prisma.ncmEntry.findMany.mock.calls[0][0].where;
 };
 it('uses the same code query with and without dots or spaces',async()=>{
  const raw=await run('61091000');expect(raw).toEqual({level:8,code:{startsWith:'61091000'}});
  expect(await run('6109.10.00')).toEqual(raw);expect(await run(' 6109 10 00 ')).toEqual(raw);
 });
 it('supports unformatted and formatted code prefixes',async()=>{
  expect(await run('610910')).toEqual(await run('6109.10'));
 });
 it('retains accent-insensitive description searches',async()=>{
  expect(await run('Algodão camiseta')).toMatchObject({AND:[{searchText:{contains:'algodao'}},{searchText:{contains:'camiseta'}}]});
 });
});
