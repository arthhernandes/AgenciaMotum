import { blingGrade } from '../src/bling/bling-grade';
import { correspondingVariant } from '../src/listing-links/sku-correspondence';

describe('Bling grade labels',()=>{
 it('corrects confirmed color/size reversals while retaining the exact SKU',()=>{
  const grade=blingGrade('G','MARINHO');expect(grade).toEqual({color:'MARINHO',size:'G'});
  expect(correspondingVariant([{sku:'31886.6',cor:grade.color!,tamanho:grade.size!}],'Marinho','G')?.sku).toBe('31886.6');
 });
 it.each([['MARINHO','G'],['M','42'],['VERDE','AZUL'],[null,null]])('does not guess ambiguous or already correct labels: %s/%s',(color,size)=>{
  expect(blingGrade(color,size)).toEqual({color,size});
 });
});
