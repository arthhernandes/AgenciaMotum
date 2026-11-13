import { of } from 'rxjs';
import { ListingEditorService } from '../src/chat/listing-editor.service';
import { MercadoLivreClient } from '../src/mercadolivre/mercadolivre.client';

describe('Listing photo file upload',()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
  function setup(){
    const prisma:any={marketplaceAccount:{findFirst:jest.fn().mockResolvedValue({id:'bling',businessKey:'shop'})}};
    const market:any={authorizeFiscal:jest.fn(),chartSource:jest.fn().mockResolvedValue({token:'private-token',account:{id:'ml'},item:{id:'MLB123',status:'active'}})};
    const client:any={uploadPicture:jest.fn().mockResolvedValue({id:'123-MLB456_102026',variations:[{secure_url:'https://http2.mlstatic.com/photo.jpg'}]})};
    const service=new ListingEditorService(prisma,client,market,{} as any);
    return {service,prisma,market,client};
  }
  it('checks ownership and uploads the file without modifying any listing',async()=>{
    const f=setup();const result=await f.service.uploadPhoto('bling','user','MLB123',{buffer:png,mimetype:'image/png'});
    expect(f.market.authorizeFiscal).toHaveBeenCalledWith('user');
    expect(f.market.chartSource).toHaveBeenCalledWith({id:'bling',businessKey:'shop'},'MLB123');
    expect(f.client.uploadPicture).toHaveBeenCalledWith('private-token',png,'image/png');
    expect(result).toEqual({id:'123-MLB456_102026',url:'https://http2.mlstatic.com/photo.jpg'});
    expect(JSON.stringify(result)).not.toContain('private-token');
  });
  it('rejects empty, oversized and disguised non-image files before contacting the marketplace',async()=>{
    const f=setup();for(const buffer of [Buffer.alloc(0),Buffer.alloc(10*1024*1024+1),Buffer.from('<script>bad</script>')])await expect(f.service.uploadPhoto('bling','user','MLB123',{buffer,mimetype:'image/png'})).rejects.toThrow();
    expect(f.client.uploadPicture).not.toHaveBeenCalled();
  });
  it('does not upload when permissions or seller ownership checks fail',async()=>{
    const f=setup();f.market.chartSource.mockRejectedValue(new Error('Other seller'));
    await expect(f.service.uploadPhoto('bling','user','MLB123',{buffer:png,mimetype:'image/png'})).rejects.toThrow('Other seller');
    expect(f.client.uploadPicture).not.toHaveBeenCalled();
    f.market.authorizeFiscal.mockRejectedValue(new Error('No permission'));
    await expect(f.service.uploadPhoto('bling','user','MLB123',{buffer:png,mimetype:'image/png'})).rejects.toThrow('No permission');
  });
  it('returns a safe error for provider failures without leaking credentials',async()=>{
    const f=setup();f.client.uploadPicture.mockRejectedValue(new Error('private-token'));
    await expect(f.service.uploadPhoto('bling','user','MLB123',{buffer:png,mimetype:'image/png'})).rejects.toThrow('Mercado Livre');
  });
  it('sends a real multipart file to the official upload endpoint',async()=>{
    const http:any={post:jest.fn().mockReturnValue(of({data:{id:'123-MLB456_102026'}}))};
    const client=new MercadoLivreClient(http);
    await client.uploadPicture('token',png,'image/png');
    const [url,body,options]=http.post.mock.calls[0];
    expect(url).toBe('https://api.mercadolibre.com/pictures/items/upload');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file').name).toBe('foto.png');
    expect(Buffer.from(await body.get('file').arrayBuffer())).toEqual(png);
    expect(options.headers).toEqual({Authorization:'Bearer token'});
  });
});
