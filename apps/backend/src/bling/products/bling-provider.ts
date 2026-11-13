export interface BlingProductRecord {
  blingProductId: string;
  sku: string;
  title: string;
  brand?: string;
  category?: string;
}

export interface BlingProductVariantRecord {
  blingProductId: string;
  blingVariantId: string;
  sku: string;
  color?: string;
  size?: string;
  stock: number;
}

export interface BlingProvider {
  getProducts(): Promise<BlingProductRecord[]>;
  getProductVariants(): Promise<BlingProductVariantRecord[]>;
}
