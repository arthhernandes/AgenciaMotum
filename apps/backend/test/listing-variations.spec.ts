import { ChatService } from '../src/chat/chat.service';

describe('Listing variation selection',()=>{
  const setup=(userProducts=false)=>{
    const market={assertWritable:jest.fn(),authorizeFiscal:jest.fn(),chartPolicy:jest.fn().mockResolvedValue({supported:false,required:false,status:'NOT_APPLICABLE'})};
    const service=new ChatService({} as any,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any,market as any);
    jest.spyOn(service as any,'account').mockResolvedValue({id:'bling1',businessKey:'mottum'});
    const rows=[{sku:'100.1',cor:'Azul',tamanho:'P',jaExisteNoPai:true,ofertaPublicada:true},{sku:'100.2',cor:'Azul',tamanho:'M',jaExisteNoPai:true,ofertaPublicada:false},{sku:'100.3',cor:'Verde',tamanho:'G',jaExisteNoPai:false,ofertaPublicada:false}];
    const tool=jest.spyOn(service as any,'executeTool').mockImplementation(async(...args:any[])=>{
      if(args[0]==='consultar_variacoes_do_anuncio')Object.assign(args[5],{title:'Camisa',userProducts,chosenPrice:99.9,catalogRows:rows});
      else args[4].push({id:'action1',label:'Adicionar variações'});
    });
    return {service,market,tool};
  };
  it('only offers absent traditional variants',async()=>{
    const f=setup();const catalog=await f.service.listingVariations('bling1','u','MLB1');
    expect(catalog.rows.map(row=>row.available)).toEqual([false,false,true]);
    expect(f.market.authorizeFiscal).toHaveBeenCalledWith('u');
  });
  it('allows publishing registered User Product variants without an offer',async()=>{
    const f=setup(true);const catalog=await f.service.listingVariations('bling1','u','MLB1');
    expect(catalog.rows.map(row=>row.available)).toEqual([false,true,true]);
  });
  it.each(['OTHER.1','100.1'])('rejects foreign or already-published SKU %s before preparing a write',async sku=>{
    const f=setup(true);await expect(f.service.prepareListingVariations('bling1','u',{reference:'MLB1',skus:[sku]})).rejects.toThrow('já existe ou não pertence');
    expect(f.tool).toHaveBeenCalledTimes(1);
  });
  it('prepares exactly the selected SKUs through the existing AI workflow and carries price and chart',async()=>{
    const f=setup(true);const result=await f.service.prepareListingVariations('bling1','u',{reference:'MLB1',skus:['100.3','100.3'],price:129.9,sizeChartId:'123'});
    expect(result.actions).toHaveLength(1);
    const call=f.tool.mock.calls[1];expect(call[0]).toBe('preparar_variantes_da_familia_ml');
    expect(call[1]).toEqual({anuncio:'MLB1',variacoes:[{sku:'100.3',fotos:null}]});
    expect(call[5]).toMatchObject({chosenPrice:129.9,sizeChartId:'123',inheritPrice:false});
  });
  it('inherits the current price when none is requested',async()=>{
    const f=setup();await f.service.prepareListingVariations('bling1','u',{reference:'MLB1',skus:['100.3']});
    expect(f.tool.mock.calls[1][5]).toMatchObject({chosenPrice:99.9,inheritPrice:true});
  });
  it.each([0,-1,1.234])('rejects invalid prices: %s',async price=>{
    const f=setup();await expect(f.service.prepareListingVariations('bling1','u',{reference:'MLB1',skus:['100.3'],price})).rejects.toThrow('preço positivo');
    expect(f.tool).toHaveBeenCalledTimes(1);
  });
  it('prepares all 48 selected variations as one confirmation',async()=>{
    const f=setup();const skus=Array.from({length:48},(_,i)=>'ALL.'+i);
    jest.spyOn(f.service,'listingVariations').mockResolvedValue({rows:skus.map(sku=>({sku,available:true})),price:100,userProducts:false} as any);
    const result=await f.service.prepareListingVariations('bling1','u',{reference:'MLB1',skus});
    expect(result.actions).toHaveLength(1);const request=f.tool.mock.calls.find(call=>call[0]==='preparar_variantes_da_familia_ml');expect((request![1] as any).variacoes.map((row:any)=>row.sku)).toEqual(skus);
  });
  it('rejects an empty selection',async()=>{
    const f=setup();await expect(f.service.prepareListingVariations('bling1','u',{reference:'MLB1',skus:[]})).rejects.toThrow('Selecione');
    expect(f.tool).not.toHaveBeenCalled();
  });
});
