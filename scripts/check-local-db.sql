SELECT
  (SELECT count(*) FROM "User") AS users,
  (SELECT count(*) FROM "Product") AS products,
  (SELECT count(*) FROM "MarketplaceListing") AS listings,
  (SELECT count(*) FROM "AuditIssue") AS issues;
