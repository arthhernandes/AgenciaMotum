import { ChatSizeCharts, checkedChartRows } from '../src/chat/chat-size-charts';

describe('Available size charts and publication coverage',()=>{
  const source={token:'private',account:{sellerId:'123'},item:{id:'MLB1',domain_id:'MLB-SHIRTS',site_id:'MLB',attributes:[{id:'GENDER',value_name:'Masculino'}]}};
  const sizes=['P','M','G','GG','XXG'];
  it('covers numbered apparel sizes with a plain size chart',()=>{
    const mapped=checkedChartRows(chart(),source,['2.P','3.M','4.G','5.GG','6.XXG']);
    expect(sizes.map(size=>mapped[size])).toEqual(['1:0','1:1','1:2','1:3','1:4']);
    const numbered=chart();numbered.rows.forEach((row,index)=>row.attributes[0].values[0].name=(index+2)+'.'+sizes[index]);
    expect(sizes.map(size=>checkedChartRows(numbered,source,sizes)[size])).toEqual(['1:0','1:1','1:2','1:3','1:4']);
  });
  function chart(id='1'){return {id,seller_id:123,type:'SPECIFIC',site_id:'MLB',domain_id:'SHIRTS',names:{MLB:'Polo Levis'},rows:sizes.map((size,index)=>({id:`${id}:${index}`,attributes:[{id:'SIZE',values:[{name:size}]},{id:'CHEST_WIDTH',name:'Largura do peito',values:[{name:'48 cm'}]}]}))};}
  it('loads every page under the selected seller, site and domain and marks missing sizes unavailable',async()=>{
    const complete=chart(),incomplete=chart('2');incomplete.rows=incomplete.rows.filter(row=>row.attributes[0].values[0].name!=='XXG');
    const client={searchSizeCharts:jest.fn().mockResolvedValueOnce({paging:{total:2},charts:[complete]}).mockResolvedValueOnce({paging:{total:2},charts:[incomplete]}),getSizeChart:jest.fn()};
    const result=await new ChatSizeCharts(client as never).list(source,sizes);
    expect(client.searchSizeCharts.mock.calls.map(call=>call[2])).toEqual([0,1]);expect(client.searchSizeCharts.mock.calls[0][1]).toEqual({domain_id:'SHIRTS',site_id:'MLB',seller_id:123,attributes:[{id:'GENDER',values:[{name:'Masculino'}]}]});
    expect(result[0].compatible).toBe(true);expect(result[0].rows[0].measurements[0].value).toBe('48 cm');expect(result[1].compatible).toBe(false);expect(result[1].reason).toContain('XXG');
  });
  it('rejects a chart ID not advertised for this seller and category',async()=>{
    const client={searchSizeCharts:jest.fn().mockResolvedValue({charts:[chart()]}),getSizeChart:jest.fn()};
    await expect(new ChatSizeCharts(client as never).select(source,'999',sizes)).rejects.toThrow('não está disponível');expect(client.getSizeChart).not.toHaveBeenCalled();
  });
  it('rechecks chart coverage after selection instead of trusting the list response',async()=>{
    const incomplete=chart();incomplete.rows=incomplete.rows.slice(0,4);const client={searchSizeCharts:jest.fn().mockResolvedValue({charts:[chart()]}),getSizeChart:jest.fn().mockResolvedValue(incomplete)};
    await expect(new ChatSizeCharts(client as never).select(source,'1',sizes)).rejects.toThrow('XXG');
  });
  it('rejects another seller or domain and supports provider standard guides',()=>{
    expect(()=>checkedChartRows({...chart(),seller_id:999},source,sizes)).toThrow('não pertence');expect(()=>checkedChartRows({...chart(),domain_id:'SNEAKERS'},source,sizes)).toThrow('categoria');
    expect(checkedChartRows({...chart(),type:'STANDARD',seller_id:null},source,sizes).XXG).toBe('1:4');
  });
  it('keeps exact XXG and XGG rows separate and only uses a spelling alias when necessary',()=>{
    const guide=chart();guide.rows.push({id:'1:extra',attributes:[{id:'SIZE',values:[{name:'XGG'}]}]} as never);const mapped=checkedChartRows(guide,source,['XXG','XGG']);expect(mapped.XXG).toBe('1:4');expect(mapped.XGG).toBe('1:extra');
    guide.rows=guide.rows.filter(row=>row.attributes[0].values[0].name!=='XXG');expect(checkedChartRows(guide,source,['XXG']).XXG).toBe('1:extra');
  });
  it('equates Portuguese sizes with international labels in either direction',()=>{
    const guide=chart();
    const mapped=checkedChartRows(guide,source,['S/P','M/M','L/G','XL/GG','XXL/XXG']);
    expect([mapped['S/P'],mapped['M/M'],mapped['L/G'],mapped['XL/GG'],mapped['XXL/XXG']]).toEqual(['1:0','1:1','1:2','1:3','1:4']);
    const paired=chart();['S/P','M/M','L/G','XL/GG','XXL/XXG'].forEach((size,i)=>paired.rows[i].attributes[0].values[0].name=size);
    const reverse=checkedChartRows(paired,source,sizes);
    expect(sizes.map(size=>reverse[size])).toEqual(['1:0','1:1','1:2','1:3','1:4']);
  });
  it('does not guess between conflicting equivalent rows or conflate numeric ranges',()=>{
    const guide=chart();guide.rows.push({id:'other',attributes:[{id:'SIZE',values:[{name:'S'}]}]} as never);
    expect(()=>checkedChartRows(guide,source,['S/P'])).toThrow('mais de uma linha equivalente');
    expect(()=>checkedChartRows(chart(),source,['P/G'])).toThrow('não atende');
    expect(()=>checkedChartRows(chart(),source,['40/42'])).toThrow('não atende');
  });
});
