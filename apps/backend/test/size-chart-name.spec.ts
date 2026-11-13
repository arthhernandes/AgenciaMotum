import { sizeChartName } from '../src/mercadolivre/size-chart-name';
describe('Product name and creation date for size charts',()=>{
  it('uses the creation date in Sao Paulo and removes unsupported characters',()=>{
    expect(sizeChartName('Polo Levi’s® Housemark',new Date('2026-10-14T01:00:00Z'))).toBe('Polo Levis Housemark 13 10 2026');
  });
  it('preserves the full date within the provider name limit',()=>{
    const name=sizeChartName('Produto muito longo '.repeat(10),new Date('2026-10-13T12:00:00Z'));
    expect(name.length).toBeLessThanOrEqual(60);expect(name.endsWith('13 10 2026')).toBe(true);
  });
});
