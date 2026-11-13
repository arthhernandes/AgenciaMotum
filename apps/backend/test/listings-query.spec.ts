import { ValidationPipe } from '@nestjs/common';
import { ListingsQuery } from '../src/listings/dto';

describe('Listings query', () => {
  it('preserves the selected account and supplies pagination when omitted by the page', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const query = await pipe.transform({ marketplaceAccountId: 'bling-ts-comercio' }, { type: 'query', metatype: ListingsQuery });
    expect(query).toMatchObject({ page: 1, limit: 50, marketplaceAccountId: 'bling-ts-comercio' });
  });
});
