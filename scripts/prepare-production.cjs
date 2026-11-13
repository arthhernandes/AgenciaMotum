const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'apps/backend/.env');
if (fs.existsSync(target)) {
  console.log('apps/backend/.env já existe e foi preservado.');
} else {
  const template = fs.readFileSync(path.join(root, 'deploy/server.env.example'), 'utf8');
  const content = template
    .replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=' + randomBytes(48).toString('base64url'))
    .replace(/^MASTER_ADMIN_PASSWORD=.*$/m, 'MASTER_ADMIN_PASSWORD=' + randomBytes(24).toString('base64url'));
  fs.writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
  console.log('apps/backend/.env criado com JWT_SECRET e senha master aleatórios. Os valores não são exibidos.');
  console.log('Preencha DATABASE_URL, DIRECT_URL, MASTER_ADMIN_EMAIL e as credenciais das integrações nesse arquivo.');
}
