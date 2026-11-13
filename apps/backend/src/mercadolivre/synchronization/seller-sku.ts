export function sellerSku(raw: unknown): string | undefined {
  const data = raw as { attributes?: Array<{ id?: string; value_name?: string; values?: Array<{ name?: string }> }>; seller_custom_field?: string } | null;
  const attribute = data?.attributes?.find(value => value.id === 'SELLER_SKU');
  const sku = attribute?.value_name || attribute?.values?.[0]?.name || data?.seller_custom_field;
  return typeof sku === 'string' && sku.trim() ? sku.trim() : undefined;
}
