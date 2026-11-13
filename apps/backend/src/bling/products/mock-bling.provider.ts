import { Injectable } from '@nestjs/common';
import { BlingProductRecord, BlingProductVariantRecord, BlingProvider } from './bling-provider';

@Injectable()
export class MockBlingProvider implements BlingProvider {
  async getProducts(): Promise<BlingProductRecord[]> {
    return [];
  }

  async getProductVariants(): Promise<BlingProductVariantRecord[]> {
    return [];
  }
}
