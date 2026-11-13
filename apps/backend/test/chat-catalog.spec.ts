import { assertCatalogAttributes, catalogPresence, catalogSummary, chosenPrice, familyPublicationSummary, requestsMissingCatalog } from '../src/chat/chat-catalog';
import { conversationContext } from '../src/chat/chat-context';

describe('Authoritative catalog rows and price decisions', () => {
  it('allows a new offer for a moderated size, but not after a manual active offer appears',()=>{
    const row={sku:'5586.224',color:'Verde Claro',size:'M'};
    const family:any={anuncios:[],variantesDaFamilia:[{id:'UP1',cor:'Verde-claro',tamanho:'M',ofertas:[{mlb:'OLD',status:'under_review',subStatus:['forbidden']}]}]};
    expect(catalogPresence(row,family).novaOfertaDisponivel).toBe(true);
    family.variantesDaFamilia[0].ofertas.push({mlb:'NEW',status:'active',estoque:5});
    expect(catalogPresence(row,family).novaOfertaDisponivel).toBeUndefined();
    family.variantesDaFamilia[0].ofertas[1].status='paused';
    expect(catalogPresence(row,family).novaOfertaDisponivel).toBeUndefined();
  });
  it('keeps missing sizes selectable when other sizes of the same color already exist',()=>{
    const family={anuncios:[{status:'active',variacoes:['P','M'].map(size=>({sku:'verde-'+size,atributos:[{id:'COLOR',value_name:'Verde'},{id:'SIZE',value_name:size}]}))}]};
    for(const size of ['G','GG'])expect(catalogPresence({sku:'verde-'+size,color:'VERDE',size},family).jaExisteNoPai).toBe(false);
    for(const size of ['P','M'])expect(catalogPresence({sku:'verde-'+size,color:'VERDE',size},family).jaExisteNoPai).toBe(true);
  });
  it('only blocks an existing full color/size combination, even if its marketplace SKU differs',()=>{
    const family={anuncios:[{status:'active',variacoes:[{sku:'old-sku',atributos:[{id:'COLOR',value_name:'Verde'},{id:'SIZE',value_name:'XL'}]}]}]};
    expect(catalogPresence({sku:'new-sku',color:'VERDE',size:'GG'},family).jaExisteNoPai).toBe(true);
    expect(catalogPresence({sku:'another-sku',color:'VERDE',size:'G'},family).jaExisteNoPai).toBe(false);
  });
  it('reports a forbidden offer as blocked, with its reason, instead of offering replacement',()=>{
    const result=catalogPresence({sku:'5586.224',color:'Verde Claro',size:'M'},{anuncios:[{status:'under_review',subStatus:['forbidden'],motivoModeracao:'Envie a NF-e.',variacoes:[{sku:'5586.224'}]}]});
    expect(result.pendenciaModeracao).toBe('forbidden');expect(result.motivoModeracao).toBe('Envie a NF-e.');expect(result.substituivelEmAnalise).toBeUndefined();
  });
  it('uses each traditional variation stock instead of the whole parent stock',()=>{
    const family={anuncios:[{status:'active',estoque:100,variacoes:[{sku:'zero',estoque:0},{sku:'live',estoque:8}]}]};
    expect(catalogPresence({sku:'zero',color:'Amarelo',size:'P'},family)).toEqual({jaExisteNoPai:true,cadastradaNaFamilia:true,ofertaPublicada:true,ofertaAtiva:false});
    expect(catalogPresence({sku:'live',color:'Azul Royal',size:'G'},family).ofertaAtiva).toBe(true);
  });
  it('distinguishes a family record without offers from a live listing, including duplicate family records',()=>{
    const row={sku:'54446.22',color:'CINZA CLARO',size:'GG'};
    const family={anuncios:[],variantesDaFamilia:[{id:'UP1',cor:'Cinza Claro',tamanho:'GG',ofertas:[]}]};
    expect(catalogPresence(row,family)).toEqual({cadastrosSemOferta:['UP1'],jaExisteNoPai:true,cadastradaNaFamilia:true,ofertaPublicada:false,ofertaAtiva:false});
    family.variantesDaFamilia.push({id:'UP2',cor:'CINZA CLARO',tamanho:'GG',ofertas:[{mlb:'MLB1',status:'active',estoque:3}] as never});
    expect(catalogPresence(row,family).ofertaAtiva).toBe(true);
  });
  it.each([['paused',3],['active',0],['under_review',3]])('does not call an offer active when status is %s and stock is %s',(status,stock)=>{
    const presence=catalogPresence({sku:'1',color:'Azul Royal',size:'G'},{anuncios:[{status,estoque:stock,variacoes:[{sku:'1'}]}]});
    expect(presence.ofertaAtiva).toBe(false);expect(presence.ofertaPublicada).toBe(true);
  });
  it('reports five active blue sizes separately from twenty unpublished combinations',()=>{
    const rows=['Azul Royal','Amarelo','Preto','CINZA CLARO','Branco'].flatMap(color=>['P','M','G','GG','XXG'].map(size=>({sku:color+size,cor:color,tamanho:size,estoqueBling:5,quantidadePublicavel:5,jaExisteNoPai:true,cadastradaNaFamilia:true,ofertaPublicada:color==='Azul Royal',ofertaAtiva:color==='Azul Royal'})));
    const summary=familyPublicationSummary(rows);
    expect(summary).toContain('5 de 25 (Azul Royal)');expect(summary).toContain('20 combinações ainda não têm oferta publicada');
    expect(catalogSummary('Polo',rows)).toContain('Amarelo GG');
  });
  it('only authorizes automatic preparation for an explicit whole missing catalog request',()=>{
    expect(requestsMissingCatalog('Adicionado as outras variações de cores com os tamanhos conforme temos na Bling')).toBe(true);
    expect(requestsMissingCatalog('Confira se os SKUs do anúncio estão batendo com o da Bling. Também adicione as variações que estão na Bling que não estão no Mercado Livre')).toBe(true);
    for(const text of ['Adicione apenas Cinza Claro GG conforme a Bling','Consulte todas as variações da Bling','Não adicione outras variações da Bling','Adicione todas as cores da Bling exceto Amarelo']) expect(requestsMissingCatalog(text)).toBe(false);
  });
  it.each([
    'Também adicione as cores de variações que faltam ser adicionadas que estão na Bling e não no Mercado Livre',
    'Inclua no anúncio os tamanhos ausentes do catálogo Bling',
    'Acrescente as cores que temos na Bling mas não no anúncio',
    'Complete as variações conforme a Bling, estão faltando cores',
    'Adicione conforme a Bling as variações faltantes',
    'Verifique os SKUs. Também adicione as variações da Bling que não estão no Mercado Livre'
  ])('recognizes whole missing catalog intent regardless of word order: %s',text=>{
    expect(requestsMissingCatalog(text)).toBe(true);
  });
  it.each([
    ['54446.2', 'Amarelo', 'Branco'], ['54446.22', 'CINZA CLARO', 'Azul Royal']
  ])('rejects moving SKU %s into another color', (sku,color,wrong) => {
    expect(() => assertCatalogAttributes({sku,color,size:'GG'},[{id:'COLOR',value_name:wrong},{id:'SIZE',value_name:'GG'}])).toThrow(sku);
    expect(() => assertCatalogAttributes({sku,color,size:'GG'},[{id:'COLOR',value_name:color.toLowerCase()},{id:'SIZE',value_name:'GG'}])).not.toThrow();
  });
  it('retains the chosen price across stock questions and a shortened context', () => {
    expect(chosenPrice([{role:'assistant',content:'Qual preço?'},{role:'user',content:'249,90'}])).toBe(249.9);
    const saved: any[] = [{role:'user',content:'Com o preço igual ao existente'}, {role:'assistant',content:'Qual preço: R$ 249,99 ou R$ 247,68?'}, {role:'user',content:'249,99'}, ...Array.from({length:30},()=>({role:'user',content:'Confira o estoque do Amarelo G'}))];
    const context = conversationContext(saved,{role:'user',content:'Continue'});
    expect(chosenPrice(context.decisionMessages)).toBe(249.99);
    expect(chosenPrice([...saved,{role:'user',content:'Preço de 239,99'}])).toBe(239.99);
    expect(chosenPrice([{role:'assistant',content:'Preço de 249,99'}])).toBeUndefined();
    expect(chosenPrice([{role:'user',content:'54446.22'}])).toBeUndefined();
  });
  it('renders exact catalog associations and excludes existing blue SKUs', () => {
    const rows = [{sku:'54446.2',cor:'Amarelo',tamanho:'GG',estoqueBling:0,quantidadePublicavel:0,jaExisteNoPai:false}, {sku:'54446.22',cor:'CINZA CLARO',tamanho:'GG',estoqueBling:26,quantidadePublicavel:26,jaExisteNoPai:false}, {sku:'54446.17',cor:'Azul Royal',tamanho:'GG',estoqueBling:8,quantidadePublicavel:8,jaExisteNoPai:true}];
    const text = catalogSummary('Polo',rows,249.99);
    expect(text).toContain('Amarelo GG — SKU 54446.2');
    expect(text).toContain('CINZA CLARO GG — SKU 54446.22');
    expect(text).not.toContain('SKU 54446.17');
    expect(text).toContain('não uma proposta');
  });
});
