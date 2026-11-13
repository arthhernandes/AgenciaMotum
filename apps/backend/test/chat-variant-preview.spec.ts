import { catalogPreviews, groupSavedVariantPreviews, variantPreviews } from '../src/chat/chat-variant-preview';
import { MarketplacePlan } from '../src/chat/chat-marketplace.service';

describe('Color groups containing all selected sizes',()=>{
  it('renders consultation rows as one card per color in size order without a publishable action',()=>{
    const rows=['GG','P','XXG','G','M'].map((size,index)=>({sku:`1.${index}`,cor:index?'Cinza Claro':'CINZA CLARO',tamanho:size,estoqueBling:3,quantidadePublicavel:3,jaExisteNoPai:false}));
    const previews=catalogPreviews('Polo','Consulta',rows,249.9);expect(previews).toHaveLength(1);expect(previews[0].fields.map(field=>field.field)).toEqual(['Tamanho P','Tamanho M','Tamanho G','Tamanho GG','Tamanho XXG']);expect(previews[0].notes[0]).toContain('não é uma proposta');
  });
  it('groups traditional additions by color while preserving the original execution payload',()=>{
    const source={kind:'update',targets:[{body:{variations:[{id:1},...['P','GG'].map((size,index)=>({price:249.9,available_quantity:3,attribute_combinations:[{id:'COLOR',value_name:index?'Cinza Claro':'CINZA CLARO'},{id:'SIZE',value_name:size}],attributes:[{id:'SELLER_SKU',value_name:`54446.${index}`}]}))]},preview:{mlb:'MLB1',title:'Polo',account:'Motum',fields:[],notes:[]}}]} as unknown as MarketplacePlan;
    const before=JSON.stringify(source);const previews=variantPreviews(source);expect(previews).toHaveLength(1);expect(previews[0].fields).toHaveLength(2);expect(previews[0].fields[0].after).toContain('SKU 54446.0');expect(JSON.stringify(source)).toBe(before);
  });
  function plan() {
    return {kind:'family_variants',targets:['Amarelo','Preto','CINZA CLARO','Branco'].flatMap((color,c)=>['G','GG','M','P','XXG'].map((size,s)=>({account:{id:'ml'},familyVariant:{familyId:'456',color,size,sku:`54446.${c*5+s+1}`},body:{attributes:[{id:'COLOR',values:[{name:color}]},{id:'SIZE',values:[{name:size}]}]},preview:{mlb:'Família 456',title:'Polo',account:'Motum',fields:[{field:'Nova variante na família',before:'Não existe',after:`${color} ${size} — SKU Bling 54446.${c*5+s+1}`},{field:'Fotos',before:'Nova variante',after:'[{"id":"photo"}]'}],notes:['Fotos herdadas; confira a cor.']}})))} as unknown as MarketplacePlan;
  }
  it('shows four colors with five sizes each and preserves all twenty execution payloads',()=>{
    const source=plan();const before=JSON.stringify(source);
    const previews=variantPreviews(source);
    expect(previews).toHaveLength(4);
    for(const preview of previews) {
      expect(preview.fields.filter(f=>f.field.startsWith('Tamanho '))).toHaveLength(5);
      expect(preview.fields.filter(f=>f.field.startsWith('Fotos'))).toHaveLength(1);
      expect(preview.notes.filter(n=>n.startsWith('Fotos herdadas'))).toHaveLength(1);
    }
    expect(previews[2].title).toContain('Cinza Claro');
    expect(JSON.stringify(source)).toBe(before);
  });
  it('groups old saved cards with multiword colors without losing SKU associations',()=>{
    const source=plan();const saved=source.targets.map(t=>t.preview);
    const result=groupSavedVariantPreviews(saved);
    expect(result).toHaveLength(4);
    expect(result[2].title).toContain('Cinza Claro');
    expect(result[2].fields.find(f=>f.field==='Tamanho GG')?.after).toBe('SKU Bling 54446.12');
    expect(saved).toHaveLength(20);
  });
  it('keeps unrelated or unrecognized previews intact',()=>{
    const source=plan();source.targets[0].preview.fields[0].field='Preço';
    const previews=source.targets.map(t=>t.preview);
    expect(groupSavedVariantPreviews(previews)).toBe(previews);
    expect(variantPreviews({...source,kind:'update'})).toEqual(previews);
  });
});


