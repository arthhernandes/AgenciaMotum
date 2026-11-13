import { correspondingVariant, sameSize, sizeKey } from '../src/listing-links/sku-correspondence';

describe('SKU correspondence', () => {
  it.each([['2.P','P'],['3.M','M'],['4.G','G'],['5.GG','GG'],['6.XXG','XXG'],['7.XXXL','XXXG']])('matches numbered catalog size %s with %s in both directions',(numbered,plain)=>{
    expect(sameSize(numbered,plain)).toBe(true);
    expect(sameSize(plain,numbered)).toBe(true);
    expect(correspondingVariant([{sku:'correct',cor:'Preto',tamanho:numbered}],'Preto',plain)?.sku).toBe('correct');
    expect(correspondingVariant([{sku:'correct',cor:'Preto',tamanho:plain}],'Preto',numbered)?.sku).toBe('correct');
  });
  it('recognizes numbered spelling aliases without conflating numeric sizes or ambiguous grades',()=>{
    expect(sameSize(' 6. xxg ','XXL')).toBe(true);
    expect(sameSize('2.P / S','P')).toBe(true);
    expect(sameSize('2.P / 3.M','P')).toBe(false);
    expect(sameSize('7.XXXL','6.XXG')).toBe(false);
    expect(sameSize('2.P','2')).toBe(false);
    expect(sameSize('40.5','40')).toBe(false);
    expect(sizeKey('40.5')).toBe('40.5');
    expect(sizeKey('2.PRODUTO')).toBe('2.PRODUTO');
    expect(correspondingVariant([{sku:'one',cor:'Preto',tamanho:'2.P'},{sku:'two',cor:'Preto',tamanho:'P'}],'Preto','P')).toBeUndefined();
  });
  it.each([39,40,41,42,43,44])('matches Brazilian shoe size %s BR and accented khaki without treating it as missing',size=>{
    const rows=[{sku:'correct',cor:'Caqui',tamanho:String(size)}];
    expect(correspondingVariant(rows,'Cáqui',`${size} BR`)?.sku).toBe('correct');
    expect(sameSize(`${size} BR`,String(size+1))).toBe(false);
    expect(sameSize(`${size} US`,String(size))).toBe(false);
    expect(sameSize(`${size} EU`,String(size))).toBe(false);
  });
  it('recognizes XGGG as XXXG in both automatic and manual size matching',()=>{
    expect(sameSize('XGGG','XXXG')).toBe(true);
    expect(sameSize('XGGG','XXG')).toBe(false);
    expect(correspondingVariant([{sku:'25366.11',cor:'MARINHO',tamanho:'XXXG'}],'Marinho','XGGG')?.sku).toBe('25366.11');
  });
  it('accepts accents in one-size labels without allowing different sizes',()=>{
    expect(sameSize('Único','Unico')).toBe(true);
    expect(sameSize('Único',' UNICO ')).toBe(true);
    expect(sameSize('Único','GG')).toBe(false);
    expect(sameSize('XL/GG','XXG')).toBe(false);
    expect(correspondingVariant([{sku:'2469.0009',cor:'Cinza',tamanho:'Unico'}],'Cinza','Único')?.sku).toBe('2469.0009');
  });
  const rows = [{sku:'54446.1',cor:'Verde-escuro',tamanho:'P'}, {sku:'54446.2',cor:'Verde escuro',tamanho:'GG'}];
  it('matches translated size pairs and punctuation in colors', () => {
    expect(correspondingVariant(rows, 'VERDE ESCURO', 'S/P')?.sku).toBe('54446.1');
    expect(correspondingVariant(rows, 'Verde-escuro', 'XL/GG')?.sku).toBe('54446.2');
    expect(sizeKey('M/M')).toBe('M');
    expect(sizeKey('L/G')).toBe('G');
  });
  it('does not guess missing attributes, different colors or conflicting sizes', () => {
    expect(correspondingVariant(rows,'','P')).toBeUndefined();
    expect(correspondingVariant(rows,'Verde','P')).toBeUndefined();
    expect(correspondingVariant(rows,'Verde escuro','P/G')).toBeUndefined();
  });
  it('blocks ambiguous catalog variations even when their SKUs differ', () => {
    expect(correspondingVariant([...rows,{sku:'54446.3',cor:'Verde escuro',tamanho:'S'}],'Verde escuro','P')).toBeUndefined();
  });
  it('keeps numeric sizes distinct', () => {
    expect(sizeKey('40')).toBe('40');
    expect(sizeKey('40/42')).toBe('');
  });
  it.each([['Preta','Preto'],['BRANCA','branco'],['Vermelha','vermelho'],['Amarela','amarelo'],['Roxa','roxo'],['Azul-clara','azul claro'],['Verde Escura','verde-escuro']])('matches spelling variants %s and %s without manual choices',(bling,ml)=>{
    expect(correspondingVariant([{sku:'correct',cor:bling,tamanho:'P'}],ml,' S / P ')?.sku).toBe('correct');
  });
  it.each([['XS/PP','PP'],['S/P','P'],['M/M','M'],['L/G','G'],['XL/GG','GG'],['XXL/XXG','XXG'],['XXL','XXG'],['XXG','XXL'],['XXXL','XXXG'],['XXXG','XXXL'],['XXXL/XXXG','XXXG']])('matches equivalent sizes %s and %s',(ml,bling)=>{
    expect(correspondingVariant([{sku:'correct',cor:'Preta',tamanho:bling}],'Preto',ml)?.sku).toBe('correct');
  });
  it('requires manual selection if gender normalization creates two candidates',()=>{
    expect(correspondingVariant([{sku:'1',cor:'Preta',tamanho:'P'},{sku:'2',cor:'Preto',tamanho:'S/P'}],'Preto','P')).toBeUndefined();
  });
  it('does not erase different shades or multicolor combinations',()=>{
    const options=[{sku:'1',cor:'Azul claro',tamanho:'P'}];
    expect(correspondingVariant(options,'Azul escuro','P')).toBeUndefined();
    expect(correspondingVariant([{sku:'1',cor:'Preta e branca',tamanho:'P'}],'Preto','P')).toBeUndefined();
  });
});
