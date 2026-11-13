import {matchesCatalogVariant} from '../src/chat/catalog-variant-match';
import {catalogPresence} from '../src/chat/chat-catalog';
describe('consistent catalog and publication identities',()=>{
 const row={sku:'5586.30',color:'Azul Royal',size:'XXXG'};
 const product=(sku:string,size='XXXL',color='Azul')=>({attributes:[{id:'SELLER_SKU',values:[{name:sku}]},{id:'COLOR',values:[{name:color}]},{id:'SIZE',values:[{name:size}]}]});
 it('uses an exact SKU across provider color names in both catalog and publication',()=>{
  const up=product('5586.30');expect(matchesCatalogVariant(row,up)).toBe(true);
  expect(catalogPresence(row,{anuncios:[{status:'under_review',variacoes:[{sku:row.sku,atributos:up.attributes}]}]}).novaOfertaDisponivel).toBe(true);
 });
 it('does not globally equate blue shades or accept an explicit size conflict',()=>{
  expect(matchesCatalogVariant(row,product('other'))).toBe(false);
  expect(matchesCatalogVariant(row,product('5586.30','M'))).toBe(false);
  expect(catalogPresence(row,{anuncios:[{status:'under_review',variacoes:[{sku:row.sku,atributos:product(row.sku,'M').attributes}]}]}).jaExisteNoPai).toBe(false);
 });
 it('reads direct attribute values and alternate size fields consistently',()=>{
  expect(matchesCatalogVariant({sku:'1',color:'Preto',size:'Unico'},{attributes:[{id:'COLOR',value_name:'Preto'},{id:'APPAREL_SIZE',value_name:'UN'}]})).toBe(true);
 });
});
