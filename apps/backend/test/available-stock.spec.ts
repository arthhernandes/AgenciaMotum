import { availableBlingStock } from '../src/bling/synchronization/available-stock';

describe('Bling available stock', () => {
  it('uses the available balance, including zero and negative values', () => {
    expect(availableBlingStock({ disponivel: 0, saldo: 20, reservado: 5 })).toBe(0);
    expect(availableBlingStock({ disponivel: -1, saldo: 0, reservado: 1 })).toBe(-1);
  });
  it('subtracts reservations when the available field is absent', () => {
    expect(availableBlingStock({ saldo: 20, reservado: 5 })).toBe(15);
  });
  it('rejects physical stock alone and malformed responses', () => {
    expect(() => availableBlingStock({ saldo: 20 })).toThrow();
    expect(() => availableBlingStock({})).toThrow();
    expect(() => availableBlingStock({ disponivel: NaN })).toThrow();
  });
});
