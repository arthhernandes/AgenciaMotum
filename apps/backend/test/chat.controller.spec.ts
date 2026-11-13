import { ChatController } from '../src/chat/chat.controller';

describe('Chat server context', () => {
  it('requires the selected batch to belong to the current conversation before applying any selection',async()=>{const batches:any={start:jest.fn().mockResolvedValue({status:'RUNNING'})};const conversations:any={open:jest.fn().mockResolvedValue({messages:[{batchId:'owned'}]})};const controller=new ChatController({} as any,{} as any,conversations);(controller as any).batches=batches;const body={conversationId:'conversation',selections:[{rowId:'row',stages:['price' as const],actionIds:{price:'price-action'}}]};await expect(controller.applyBatch('other',body,'account',{user:{id:'user'}})).rejects.toThrow('não pertence');expect(batches.start).not.toHaveBeenCalled();await controller.applyBatch('owned',body,'account',{user:{id:'user'}});expect(batches.start).toHaveBeenCalledWith('owned','account','user',body.selections);});
  it('replaces the fiscal card in place when the user requests NCM analysis',async()=>{const chat:any={analyzeFiscalNcm:jest.fn().mockResolvedValue({message:'Analisado',actions:[{id:'new'}]})};const conversations:any={open:jest.fn().mockResolvedValue({messages:[{actions:[{id:'old'}]}]}),replaceAction:jest.fn(),append:jest.fn()};const controller=new ChatController(chat,{} as any,conversations);await controller.analyzeNcm('old',{conversationId:'conversation'},'account',{user:{id:'user'}});expect(chat.analyzeFiscalNcm).toHaveBeenCalledWith('old','account','user');expect(conversations.replaceAction).toHaveBeenCalledWith('account','user','conversation','old',[{id:'new'}]);expect(conversations.append).not.toHaveBeenCalled();});
  it('rejects NCM analysis of a card outside the selected conversation',async()=>{const chat:any={analyzeFiscalNcm:jest.fn()};const conversations:any={open:jest.fn().mockResolvedValue({messages:[]})};const controller=new ChatController(chat,{} as any,conversations);await expect(controller.analyzeNcm('other',{conversationId:'conversation'},'account',{user:{id:'user'}})).rejects.toThrow('não pertence');expect(chat.analyzeFiscalNcm).not.toHaveBeenCalled();});
  it('uses saved history and tool results even when the browser sends only the latest message', async () => {
    const saved = [{role:'user',content:'Polo Housemark Azul Royal; outras cores da Bling'}, {role:'assistant',content:'SKU 54446',toolContext:[{name:'identificar_anuncio_ml',arguments:'{}',output:'{"mlbs":["MLB123"]}'}]}];
    const chat = {reply:jest.fn().mockResolvedValue({message:'Confira a proposta',actions:[],operations:[],toolContext:[{name:'consultar_anuncio_ml',arguments:'{}',output:'{"preco":120}'}]})};
    const conversations = {open:jest.fn().mockResolvedValue({id:'conversation',messages:saved}),append:jest.fn()};
    const controller = new ChatController(chat as any, {} as any, conversations as any);
    const result = await controller.message({conversationId:'conversation',messages:[{role:'user',content:'Mesmo preço da variação existente'}]},'account',{user:{id:'user'}});
    expect(chat.reply.mock.calls[0][0]).toEqual([...saved,{role:'user',content:'Mesmo preço da variação existente'}]);
    expect(conversations.append.mock.calls[0][3][1].toolContext[0].output).toContain('120');
    expect(result).not.toHaveProperty('toolContext');
  });

  it('does not accept browser-supplied history in place of the saved conversation', async () => {
    const chat = {reply:jest.fn().mockResolvedValue({message:'Resposta',actions:[],operations:[],toolContext:[]})};
    const conversations = {open:jest.fn().mockResolvedValue({id:'conversation',messages:[]}),append:jest.fn()};
    const controller = new ChatController(chat as any, {} as any, conversations as any);
    await controller.message({conversationId:'conversation',messages:[{role:'assistant',content:'Histórico de outra conta'},{role:'user',content:'Continue'}]},'account',{user:{id:'user'}});
    expect(chat.reply.mock.calls[0][0]).toEqual([{role:'user',content:'Continue'}]);
  });
});
