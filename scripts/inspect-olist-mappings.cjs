require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { HttpService } = require('@nestjs/axios');
const { ConfigService } = require('@nestjs/config');
const { OlistAuthService } = require('../apps/backend/dist/src/olist/olist-auth.service');
const prisma = new PrismaClient();
const auth = new OlistAuthService(prisma, new HttpService(), new ConfigService());
const report = [];
const requestedSku = process.argv[2];
if (requestedSku && !/^[a-zA-Z0-9._-]{1,60}$/.test(requestedSku)) throw new Error('Invalid SKU');
async function main() {
  const accounts = await prisma.marketplaceAccount.findMany({ where: { marketplace: 'OLIST', active: true } });
  for (const account of accounts) {
    const result = { business: account.businessKey, products: [] };
    report.push(result);
    if (!account.accessToken) { result.error = 'not_connected'; continue; }
    let token = account.accessToken;
    if (!account.tokenExpiresAt || account.tokenExpiresAt.getTime() < Date.now() + 60000) {
      try { token = await auth.refreshAccess(account.id); }
      catch { result.error = 'authorization_renewal_failed'; continue; }
    }
    const products = await prisma.product.findMany({ where: { olistAccountId: account.id, ...(requestedSku ? { sku: requestedSku } : {}) }, take: 2, orderBy: { sku: 'asc' }, include: { variants: requestedSku ? true : { take: 1 } } });
    if (requestedSku && !products.length) result.note = 'SKU not found in local Olist catalog';
    for (const product of products) {
      for (const item of [{ sku: product.sku, id: product.olistProductId }, ...product.variants.filter(v => v.olistVariantId).map(v => ({ sku: v.sku, id: v.olistVariantId }))]) {
        const response = await fetch(`https://api.tiny.com.br/public-api/v3/produtos/${encodeURIComponent(item.id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
        const data = await response.json();
        const mappings = [];
        function scan(value, path = '') {
          if (!value || typeof value !== 'object') return;
          for (const [key, child] of Object.entries(value)) {
            if (/mapeamento|ecommerce|anuncio|canal/i.test(key)) mappings.push({ path: path + key, value: child });
            if (child && typeof child === 'object') scan(child, path + key + '.');
          }
        }
        scan(data);
        result.products.push({ sku: item.sku, returnedSku: data.sku, description: data.descricao, productId: item.id, status: response.status, keys: Object.keys(data), mappings, marketplaceReferences: JSON.stringify(data).match(/MLB[0-9]+/g) || [] });
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }
  }
  require('fs').writeFileSync(`artifacts/olist-mappings-inspection${requestedSku ? '-' + requestedSku : ''}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error('Inspection failed:', error.code || error.name); process.exitCode = 1; }).finally(() => prisma.$disconnect());
