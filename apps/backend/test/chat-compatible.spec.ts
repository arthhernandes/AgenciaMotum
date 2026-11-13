import { compatibleEndpoint, compatibleMessages, compatibleOutput, compatibleTools } from '../src/chat/chat-compatible';

describe('Qwen chat compatibility', () => {
  it('supports server roots and /v1 bases without accepting credentials in URLs', () => {
    expect(compatibleEndpoint('http://server:11434')).toBe('http://server:11434/v1/chat/completions');
    expect(compatibleEndpoint('http://server:8000/v1/')).toBe('http://server:8000/v1/chat/completions');
    expect(()=>compatibleEndpoint('file:///secret')).toThrow();
    expect(()=>compatibleEndpoint('http://user:password@server/v1')).toThrow();
  });
  it('replays multiple tool calls in one assistant message with correlated outputs', () => {
    const messages = compatibleMessages([
      {role:'user',content:'Consulte'},
      {type:'message',content:[{type:'output_text',text:'Vou consultar.'}]},
      {type:'function_call',call_id:'a',name:'consultar_produtos',arguments:'{"busca":"123"}'},
      {type:'function_call',call_id:'b',name:'consultar_sincronizacoes',arguments:'{}'},
      {type:'function_call_output',call_id:'a',output:'{"total":1}'},
      {type:'function_call_output',call_id:'b',output:'[]'}
    ], 'instructions');
    expect(messages[0]).toEqual({role:'system',content:'instructions'});
    expect(messages[2].tool_calls.map((c:any)=>c.id)).toEqual(['a','b']);
    expect(messages[3]).toEqual({role:'tool',tool_call_id:'a',content:'{"total":1}'});
    expect(messages[4].tool_call_id).toBe('b');
  });
  it('accepts Qwen tool arguments as objects or JSON strings', () => {
    const response = compatibleOutput({choices:[{message:{content:null,tool_calls:[{id:'c',function:{name:'comparar_estoque',arguments:{sku:'123.1'}}}]}}]});
    expect(response.output[0]).toEqual({type:'function_call',call_id:'c',name:'comparar_estoque',arguments:'{"sku":"123.1"}'});
    expect(compatibleTools().some(tool => tool.function.name === 'consultar_produtos')).toBe(true);
    expect(()=>compatibleOutput({error:'failed'})).toThrow();
  });
});
