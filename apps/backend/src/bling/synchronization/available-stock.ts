export interface BlingStockBalances {
  disponivel?: number | null;
  saldo?: number | null;
  reservado?: number | null;
}

export function availableBlingStock(stock: BlingStockBalances): number {
  // Prefer Bling's available balance; never substitute the physical balance alone.
  const available = stock.disponivel ?? (
    stock.saldo != null && stock.reservado != null
      ? stock.saldo - stock.reservado
      : undefined
  );
  if (available == null || !Number.isFinite(available)) {
    throw new Error('A Bling não retornou o estoque disponível nem os saldos físico e reservado.');
  }
  return Math.trunc(available);
}
