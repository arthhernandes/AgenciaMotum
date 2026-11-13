/** Normalized ERP product used by catalog, publication and fiscal services. */
export function normalizeBlingProduct(product: any): any {
  const parentId = product.idProdutoPai || product.variacao?.produtoPai?.id;
  const grade = typeof product.variacao?.nome === 'string'
    ? product.variacao.nome.split(';').flatMap((part: string) => {
        const separator = part.indexOf(':');
        return separator > 0 ? [{ chave: part.slice(0, separator).trim(), valor: part.slice(separator + 1).trim() }] : [];
      }) : [];
  const dimensions = product.dimensoes ?? {};
  const factor = Number(dimensions.unidadeMedida) === 0 ? 100 : Number(dimensions.unidadeMedida) === 2 ? 0.1 : 1;
  const images = product.midia?.imagens ?? {};
  return {
    ...product, sku: product.codigo, descricao: product.nome,
    tipoVariacao: parentId ? 'V' : product.formato === 'V' ? 'P' : 'N',
    produtoPai: parentId ? { id: parentId } : undefined,
    grade, variacoes: Array.isArray(product.variacoes) ? product.variacoes.map(normalizeBlingProduct) : undefined,
    precos: { preco: product.preco, precoCusto: product.fornecedor?.precoCusto ?? product.precoCusto },
    descricaoComplementar: product.descricaoComplementar ?? product.descricaoCurta ?? '',
    marca: { nome: typeof product.marca === 'string' ? product.marca : '' },
    anexos: [...(images.externas ?? []), ...(images.internas ?? [])],
    dimensoes: { altura: dimensions.altura == null ? undefined : Number(dimensions.altura) * factor,
      largura: dimensions.largura == null ? undefined : Number(dimensions.largura) * factor,
      comprimento: dimensions.profundidade == null ? undefined : Number(dimensions.profundidade) * factor,
      pesoBruto: product.pesoBruto, pesoLiquido: product.pesoLiquido }
  };
}

export function normalizeBlingPage(data: unknown, offset: number, limit: number) {
  if (!Array.isArray(data)) throw new Error('Resposta de produtos inválida do Bling.');
  return { itens: data.map(normalizeBlingProduct), paginacao: { offset, limit, total: offset + data.length + (data.length === limit ? 1 : 0) } };
}
