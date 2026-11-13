import { sizeLabel } from '../listing-links/sku-correspondence';
// Some imported Bling families have the Cor/Tamanho column labels reversed.
// Correct only unambiguous apparel size + named color pairs; never guess numeric grades.
export function blingGrade(color:string|null|undefined,size:string|null|undefined){
 const key=(value:string|null|undefined)=>String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 const apparel=/^(PPP|PP|P|M|G|GG|XG|XXG|XGG|XXXG|XXS|XS|S|L|XL|XXL|XXXL)$/;
 const namedColor=/^(PRETO|PRETA|BRANCO|BRANCA|OFF WHITE|MARINHO|AZUL|VERDE|MILITAR|VERMELHO|VERMELHA|ROSA|ROXO|ROXA|CINZA|BEGE|CAQUI|AMARELO|AMARELA|LARANJA|VINHO|BORDO|MARROM)(?:\s+(CLARO|CLARA|ESCURO|ESCURA|MARINHO|MILITAR|MESCLA))*$/;
 return apparel.test(sizeLabel(color))&&namedColor.test(key(size))?{color:size,size:color}:{color,size};
}
