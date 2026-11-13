import { normalizeBlingPage, normalizeBlingProduct } from '../src/bling/bling-api';

describe('Bling product normalization', () => {
  it('maps fiscal fields, prices, images and units from the official API', () => {
    const product=normalizeBlingProduct({id:1,nome:'Produto',codigo:'ABC.',preco:99,fornecedor:{precoCusto:50},marca:'Marca',formato:'S',pesoBruto:0.4,dimensoes:{altura:0.2,largura:0.3,profundidade:0.4,unidadeMedida:0},tributacao:{ncm:'12345678'},midia:{imagens:{externas:[{link:'https://example.test/image.jpg'}]}}});
    expect(product).toMatchObject({sku:'ABC.',descricao:'Produto',precos:{preco:99,precoCusto:50},marca:{nome:'Marca'},dimensoes:{altura:20,largura:30,comprimento:40,pesoBruto:0.4},tributacao:{ncm:'12345678'},anexos:[{link:'https://example.test/image.jpg'}]});
  });
  it('retains provider parent identity for variations', () => {
    expect(normalizeBlingProduct({id:2,codigo:'CHILD',idProdutoPai:1,formato:'S'})).toMatchObject({tipoVariacao:'V',produtoPai:{id:1}});
  });
  it('continues full pages and finishes a short or empty page', () => {
    expect(normalizeBlingPage(Array(100).fill({}),0,100).paginacao.total).toBe(101);
    expect(normalizeBlingPage([{}],100,100).paginacao.total).toBe(101);
    expect(normalizeBlingPage([],100,100).paginacao.total).toBe(100);
    expect(()=>normalizeBlingPage({},0,100)).toThrow();
  });
});
