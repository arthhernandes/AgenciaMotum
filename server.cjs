// Production entry point for Hostinger: Angular and Nest share the same domain.
process.env.SERVE_FRONTEND ??= 'true';
require('./apps/backend/dist/src/main.js');
