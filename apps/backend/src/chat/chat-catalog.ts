import { BadRequestException } from '@nestjs/common';
import {matchesCatalogVariant} from './catalog-variant-match';

export type CatalogRow = { sku: string; cor: string | null; tamanho: string | null; estoqueBling: number | null; quantidadePublicavel: number | null; jaExisteNoPai: boolean; cadastradaNaFamilia?:boolean; ofertaPublicada?:boolean; ofertaAtiva?:boolean; substituivelEmAnalise?:boolean;pendenciaModeracao?:string;motivoModeracao?:string; novaOfertaDisponivel?:boolean; cadastrosSemOferta?:string[] };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export function catalogPresence(row:{sku:string;color:string|null;size:string|null},family:{anuncios:any[];variantesDaFamilia?:any[]}){
  const variants=(family.variantesDaFamilia??[]).filter(variant=>matchesCatalogVariant(row,{sku:variant.sku,attributes:[{id:'COLOR',value_name:variant.cor},{id:'SIZE',value_name:variant.tamanho}]}));
  const matches=(variant:any)=>matchesCatalogVariant(row,{sku:variant.sku,attribute_combinations:variant.atributos??[]});
  const listings=family.anuncios.filter(listing=>listing.variacoes.some(matches));
  const listingOffers=listings.flatMap(listing=>listing.variacoes.filter(matches).map((variant:any)=>({status:listing.status,estoque:variant.estoque??listing.estoque,subStatus:listing.subStatus,motivoModeracao:listing.motivoModeracao})));
  const offers=[...variants.flatMap(variant=>variant.ofertas??[]),...listingOffers];
  const exists=variants.length>0||listings.length>0;
  const published=offers.filter(offer=>typeof offer.status==='string'&&offer.status!=='closed'&&offer.status!=='deleted');
  const blocked=published.find(offer=>offer.subStatus?.some((status:string)=>['forbidden','waiting_for_patch'].includes(status)));
  const cadastrosSemOferta=variants.filter(variant=>Array.isArray(variant.ofertas)&&variant.ofertas.length===0).map(variant=>variant.id);
  return {...(published.length>0&&published.every(offer=>['under_review','inactive'].includes(offer.status))?{novaOfertaDisponivel:true}:{}),...(cadastrosSemOferta.length?{cadastrosSemOferta}:{}),jaExisteNoPai:exists,cadastradaNaFamilia:exists,ofertaPublicada:published.length>0,ofertaAtiva:offers.some(offer=>offer.status==='active'&&(offer.estoque??0)>0),...(blocked?{pendenciaModeracao:blocked.subStatus.includes('forbidden')?'forbidden':'waiting_for_patch',motivoModeracao:blocked.motivoModeracao??'Confira a pendência no Mercado Livre.'}:{}),...(!blocked&&published.length>0&&published.every(offer=>offer.status==='under_review')?{substituivelEmAnalise:true}:{})};
}

export function familyPublicationSummary(rows:CatalogRow[]){
  const registered=rows.filter(row=>row.cadastradaNaFamilia??row.jaExisteNoPai).length;
  const checked=rows.every(row=>typeof row.ofertaAtiva==='boolean'&&typeof row.ofertaPublicada==='boolean');
  if(!checked)return `${registered} combinações de cor e tamanho estão cadastradas na família. Esse cadastro não comprova publicação nem disponibilidade no anúncio.`;
  const active=rows.filter(row=>row.ofertaAtiva).length;const unpublished=rows.filter(row=>!row.ofertaPublicada);const colors=[...new Set(rows.filter(row=>row.ofertaAtiva).map(row=>row.cor).filter(Boolean))];
  return `${registered} combinações de cor e tamanho estão cadastradas na família. Ofertas ativas confirmadas: ${active} de ${rows.length}${colors.length?' ('+colors.join(', ')+')':''}.\n${unpublished.length} combinações ainda não têm oferta publicada${unpublished.length?': '+[...new Set(unpublished.map(row=>row.cor).filter(Boolean))].join(', '):''}. Cadastro na família não significa que a variação esteja no ar.`;
}

/** Detect the requested operation independently of word order or product name.
 * Restricted color/size requests remain with the scoped preparation flow. */
export function requestsMissingCatalog(message:string) {
  const text=normalize(message);
  const additions=/adicion|complet|inclu|acrescent/.test(text);
  const catalog=/bling/.test(text)&&/varia|cores|tamanhos/.test(text);
  const missing=/\b(?:outras|todas|todos|falt\w*|ausen\w*)\b/.test(text)
    ||/nao\s+(?:possu|tem|tenha|existe|estao|esta|constam|aparecem)/.test(text)
    ||/nao[^.\n]{0,60}(?:mercado livre|anuncio)/.test(text);
  const restricted=/\b(?:apenas|somente|exceto|menos)\b|\bnao\s+(?:adicione|adicionar|adicionado|complete|completar|inclua|incluir|acrescente|acrescentar)\b/.test(text);
  return additions&&catalog&&missing&&!restricted;
}

/** A SKU identifies a catalog row, never a color guessed from a suffix. */
export function assertCatalogAttributes(row: { sku: string; color: string | null; size: string | null }, attributes: any[]) {
  for (const [ids, expected, label] of [
    [['COLOR'], row.color, 'cor'], [['SIZE', 'ALPHANUMERIC_SIZE'], row.size, 'tamanho']
  ] as Array<[string[], string | null, string]>) {
    if (!expected) continue;
    const actual = attributes.filter(a => ids.includes(a.id));
    if (!actual.length || actual.some(a => normalize(String(a.value_name ?? a.valor ?? '')) !== normalize(expected))) {
      throw new BadRequestException(`O SKU ${row.sku} corresponde a ${row.color ?? ''} ${row.size ?? ''} na Bling. Corrija o atributo de ${label}; não é permitido trocar a variação desse SKU.`);
    }
  }
}

/** Only user decisions are retained; assistant summaries are not evidence. */
export function chosenPrice(messages: Array<{ role: string; content: string }>): number | undefined {
  let price: number | undefined;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    const text = normalize(message.content);
    if (/mesmo preco|preco igual|preco atual|preco (?:do|da) (?:anuncio|variacao|modelo)/.test(text)) price = undefined;
    const bare = /^(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:reais)?[.!]?$/.exec(text);
    const explicit = /(?:preco|valor|r\$)\s*(?:de|:|=)?\s*(\d+(?:[.,]\d{1,2})?)/.exec(text);
    const answer = bare && /preco|valor|r\$/i.test(normalize(messages[i - 1]?.content ?? ''));
    const match = explicit ?? (answer ? bare : null);
    if (match) {
      const value = Number(match[1].replace(',', '.'));
      if (value > 0 && Number.isFinite(value)) price = value;
    }
  }
  return price;
}

export function catalogSummary(title: string, rows: CatalogRow[], price?: number) {
  const missing = rows.filter(row => row.ofertaAtiva===false||!row.jaExisteNoPai);
  const money = price == null ? '' : ` Preço escolhido para novas publicações: ${new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(price)}.`;
  return `Catálogo conferido para ${title}.${money}\n${familyPublicationSummary(rows)}\n\nVariações sem oferta ativa ou ainda não cadastradas, conforme a Bling (esta lista é uma consulta, não uma proposta):\n${missing.map(row => `• ${row.cor ?? 'Cor não informada'} ${row.tamanho ?? 'Tamanho não informado'} — SKU ${row.sku} — estoque ${row.quantidadePublicavel ?? 'indisponível'}${(row.estoqueBling ?? 0) < 0 ? ' (estoque negativo tratado como zero)' : ''}`).join('\n')}`;
}
