export enum Marketplace {
  MERCADO_LIVRE = 'MERCADO_LIVRE',
  BLING = 'BLING'
}

export enum UserRole {
  ADMIN = 'ADMIN',
  CONSULTANT = 'CONSULTANT',
  VIEWER = 'VIEWER'
}

export enum ListingMatchType {
  SKU = 'SKU',
  USER_PRODUCT = 'USER_PRODUCT',
  CATALOG_PRODUCT = 'CATALOG_PRODUCT',
  MANUAL = 'MANUAL',
  AUTO = 'AUTO'
}

export enum InternalStatus {
  OK = 'OK',
  ATTENTION = 'ATTENTION',
  ERROR = 'ERROR',
  NO_LISTING = 'NO_LISTING',
  REVIEW = 'REVIEW'
}

export enum AuditSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL'
}

export enum AuditIssueType {
  NO_LISTING = 'NO_LISTING',
  PAUSED_WITH_STOCK = 'PAUSED_WITH_STOCK',
  STOCK_DIVERGENCE = 'STOCK_DIVERGENCE',
  ML_SKU_NOT_FOUND = 'ML_SKU_NOT_FOUND',
  BLING_SKU_WITHOUT_VARIATION = 'BLING_SKU_WITHOUT_VARIATION',
  UNLINKED_LISTING = 'UNLINKED_LISTING',
  DUPLICATE_LISTING = 'DUPLICATE_LISTING',
  CLOSED_WITH_STOCK = 'CLOSED_WITH_STOCK',
  PRODUCT_WITHOUT_MATCH = 'PRODUCT_WITHOUT_MATCH',
  MISSING_VARIATION = 'MISSING_VARIATION',
  EXTRA_VARIATION = 'EXTRA_VARIATION'
}

export enum SyncType {
  FULL_SYNC = 'FULL_SYNC',
  INCREMENTAL_SYNC = 'INCREMENTAL_SYNC',
  MANUAL_SYNC = 'MANUAL_SYNC'
}

export enum SyncStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
  SUCCESS = 'SUCCESS',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED'
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}
