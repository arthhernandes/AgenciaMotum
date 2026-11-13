import { BadRequestException } from '@nestjs/common';

export const listingPackageFields:Record<string,{name:string;unit:'cm'|'g'}>={
 SELLER_PACKAGE_HEIGHT:{name:'Altura da embalagem (cm)',unit:'cm'},
 SELLER_PACKAGE_WIDTH:{name:'Largura da embalagem (cm)',unit:'cm'},
 SELLER_PACKAGE_LENGTH:{name:'Comprimento da embalagem (cm)',unit:'cm'},
 SELLER_PACKAGE_WEIGHT:{name:'Peso da embalagem (g)',unit:'g'}
};
export function normalizeListingPackageValue(id:string,value:string){
 const field=listingPackageFields[id];if(!field)return value.trim();
 const match=/^(\d+(?:[.,]\d+)?)\s*(cm|mm|m|kg|g)?$/i.exec(value.trim());
 if(!match)throw new BadRequestException(`Preencha ${field.name} com um número positivo e uma unidade válida.`);
 const unit=(match[2]??field.unit).toLowerCase();
 const factors:Record<string,number>=field.unit==='g'?{g:1,kg:1000}:{cm:1,mm:0.1,m:100};
 const number=Number(match[1].replace(',','.'))*factors[unit];
 const normalized=Number(number.toFixed(6));
 if(!Number.isFinite(normalized)||normalized<=0)throw new BadRequestException(`Preencha ${field.name} com um valor maior que zero, em ${field.unit}.`);
 return normalized+' '+field.unit;
}
