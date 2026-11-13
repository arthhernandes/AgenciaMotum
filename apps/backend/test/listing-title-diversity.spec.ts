import { of } from 'rxjs';
import { cleanListingTitleSource, listingTitleBrandAliases, listingTitleBrandProblem, listingTitleContentProblem, listingTitleIdentityProblem, listingTitleSimilarity, tooSimilarListingTitle } from '../src/chat/listing-title-diversity';
import { ListingDuplicationTitlesService } from '../src/chat/listing-duplication-titles.service';

const original='Camiseta Masculina Importada Polo Rl Original Clássica Lisa';
const facts=[{name:'Marca',value:'Ralph Lauren'},{name:'Manga',value:'Curta'},{name:'Gola',value:'Redonda'}];
const alternative='Camiseta Masculina Lisa Manga Curta';
const second='Camiseta Para Homem Gola Redonda';
describe('Unbranded Mercado Livre title generation',()=>{
  function setup(){const config:any={get:(key:string,fallback:any)=>({CHAT_PROVIDER:'qwen',CHAT_BASE_URL:'http://localhost:1234/v1',CHAT_MODEL:'test'} as any)[key]??fallback};const http:any={post:jest.fn()};return {http,service:new ListingDuplicationTitlesService(config,http)};}
  const response=(titles:unknown)=>of({data:{choices:[{message:{content:JSON.stringify({titles})}}]}});
  it('rejects the full brand, aliases, punctuation tricks and compact brand spellings',()=>{
    for(const title of ['Camiseta Ralph Lauren Masculina','Camiseta Polo RL Masculina','Camiseta RL Lisa','Camiseta R.L. Lisa','Camiseta RalphLauren Lisa','Camiseta Polo Masculina'])expect(listingTitleBrandProblem(title,original,facts)).toContain('marca');
    expect(listingTitleBrandProblem(alternative,original,facts)).toBeUndefined();
  });
  it('uses confirmed brand metadata for arbitrary brands and their initials',()=>{
    expect(listingTitleBrandProblem('Camiseta Hering Lisa','Camiseta Masculina',[{name:'Marca',value:'Hering'}])).toBeDefined();
    expect(listingTitleBrandProblem('Camiseta CK Lisa','Camiseta Masculina',[{name:'Marca',value:'Calvin Klein'}])).toBeDefined();
    expect(listingTitleBrandProblem('Camisa Polo Lisa','Camisa Polo Masculina',[{name:'Marca',value:'Hering'}])).toBeUndefined();
  });
  it('does not send brand or promotional text as product evidence',()=>{
    const clean=cleanListingTitleSource(original,listingTitleBrandAliases(original,facts));
    expect(clean).toBe('camiseta masculina importada classica lisa');expect(clean).not.toContain('original');
  });
  it('blocks promotional language and invented style claims from the screenshot',()=>{
    for(const title of ['Camiseta Masculina Luxo','Camiseta Autêntica Masculina','Camiseta Masculina Original','Camiseta Minimalista Esportivo','Camiseta Casual Masculina'])expect(listingTitleContentProblem(title,original,facts)).toBeDefined();
    expect(listingTitleContentProblem('Camiseta Esportiva','Camiseta Esportiva Masculina',[])).toBeUndefined();
  });
  it('accepts only confirmed specifications and faithful grammatical variations',()=>{
    expect(listingTitleContentProblem(alternative,original,facts)).toBeUndefined();
    expect(listingTitleContentProblem(second,original,facts)).toBeUndefined();
    expect(listingTitleContentProblem('Camiseta Masculina Sem Estampa',original,facts)).toBeUndefined();
    expect(listingTitleContentProblem('Camiseta Algodão Egípcio',original,facts)).toContain('não consta');
  });
  it('preserves product type and technical model identifiers, without requiring brand',()=>{
    expect(listingTitleIdentityProblem('Camisa Masculina Lisa',original,facts)).toContain('tipo');
    expect(listingTitleIdentityProblem(alternative,original,facts)).toBeUndefined();
    expect(listingTitleIdentityProblem('Calça Masculina','Calça Levis 721 Skinny',[{name:'Marca',value:'Levis'}])).toContain('721');
    expect(listingTitleIdentityProblem('Calça 721 Masculina','Calça Levis 721 Skinny',[{name:'Marca',value:'Levis'}])).toBeUndefined();
  });
  it('rejects shuffled words and cosmetic synonym changes but allows different factual focuses',()=>{
    expect(listingTitleSimilarity('Camiseta Lisa Masculina','Masculina Camiseta Lisa')).toBe(1);
    expect(tooSimilarListingTitle('Camiseta Para Homem Sem Estampa',['Camiseta Lisa Masculina'])).toBe(true);
    expect(tooSimilarListingTitle(second,[original,alternative],facts)).toBe(false);
  });
  it('discards branded or invented candidates and retries while keeping good factual suggestions',async()=>{
    const {service,http}=setup();http.post.mockReturnValueOnce(response(['Camiseta Ralph Lauren Lisa',alternative,'Camiseta Esportiva Luxo'])).mockReturnValueOnce(response([second]));
    expect(await service.generate(original,2,60,facts)).toEqual([alternative,second]);expect(http.post).toHaveBeenCalledTimes(2);
    const retry=JSON.parse(http.post.mock.calls[1][1].messages[1].content);
    expect(retry.acceptedTitles).toEqual([alternative]);expect(retry.forbiddenBrands).toContain('ralph lauren');expect(retry.originalTitle).not.toContain('polo');expect(retry.confirmedAttributes.some((f:any)=>f.name==='Marca')).toBe(false);expect(http.post.mock.calls[0][1].messages[0].content).toContain('NUNCA inclua marca');
  });
  it('does not return branded suggestions when the model repeatedly ignores the instruction',async()=>{
    const {service,http}=setup();http.post.mockReturnValue(response(['Camiseta Ralph Lauren Lisa']));await expect(service.generate(original,1,60,facts)).rejects.toThrow('IA');expect(http.post).toHaveBeenCalledTimes(3);
  });
  it('accepts a faithful reformulation of the screenshot title without requiring composition percentages',async()=>{
    const {service,http}=setup();
    http.post.mockReturnValue(response(['Camisa De Algodão Flame Texturizada Manga Curta']));
    expect(await service.generate('Camisa Manga Curta Texturizada Flame 100% Algodão',1,60)).toEqual(['Camisa De Algodão Flame Texturizada Manga Curta']);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(listingTitleIdentityProblem('Calça Skinny','Calça 721 Skinny')).toContain('721');
  });
  it('accepts reordered factual titles but does not repeat an accepted title within the batch',async()=>{
    const {service,http}=setup();
    http.post.mockReturnValue(response(['Camisa Algodão Manga Curta','Camisa Algodão Manga Curta','Camisa Manga Curta De Algodão']));
    expect(await service.generate('Camisa Manga Curta Algodão',2,60)).toEqual(['Camisa Algodão Manga Curta','Camisa Manga Curta De Algodão']);
  });
});
