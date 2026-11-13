import {variantSizeValue} from '../src/chat/variant-size-value';
describe('Canonical marketplace size values',()=>{
 const attributes=[{id:'SIZE',values:[{id:'6367305',name:'Único'}]}];
 it('reuses the official one-size identifier',()=>expect(variantSizeValue('Unico',attributes)).toEqual({id:'6367305',name:'Único'}));
 it('reuses only equivalent sizes',()=>expect(variantSizeValue('XXG',[{id:'SIZE',values:[{id:'gg',name:'XL/GG'}]}])).toEqual({id:null,name:'XXG'}));
 it('normalizes the one-size spelling without an official value',()=>expect(variantSizeValue('unico',[])).toEqual({id:null,name:'Único'}));
});
