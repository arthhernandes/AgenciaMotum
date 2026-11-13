import { localNcmOptions } from '../src/ncm/ncm-local-search';
describe('NCM keyword search without AI',()=>{
  const entries=[{code:'61091000',formattedCode:'6109.10.00',fullDescription:'Camisetas de malha de algodão',searchText:'camisetas de malha de algodao'},{code:'61099000',fullDescription:'Camisetas de outras matérias',searchText:'camisetas de outras materias'},{code:'62052000',fullDescription:'Camisas de algodão',searchText:'camisas de algodao'}];
  it('returns multiple descriptions for manual selection without selecting a code',async()=>{
    const catalog={ncmEntry:{findMany:jest.fn().mockResolvedValue(entries)}};
    const result=await localNcmOptions(catalog,[{sku:'100.1',mlb:'MLB1',title:'Camiseta de malha algodão'}]);
    expect(result[0].ncm).toBeNull();expect(result[0].options.map(row=>row.code)).toEqual(['61091000','61099000']);
    expect(result[0].options[0].description).toContain('algodão');
    expect(catalog.ncmEntry.findMany.mock.calls[0][0].where.level).toBe(8);
  });
  it('does not invent alternatives when the catalog has no match',async()=>{
    const result=await localNcmOptions({ncmEntry:{findMany:async()=>entries}},[{sku:'100',title:'Produto ZZZZZ'}]);
    expect(result[0].ncm).toBeNull();expect(result[0].options).toEqual([]);
  });
});
