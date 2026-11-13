import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Request, Response, NextFunction } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';

export function configureFrontend(app: NestExpressApplication, directory: string) {
  const index = join(directory, 'index.html');
  if (!existsSync(index)) throw new Error('Frontend compilado não encontrado. Execute npm run build:hostinger antes de iniciar o servidor.');
  // API paths always reach Nest, including unknown API routes.
  app.useStaticAssets(directory, { index: false, dotfiles: 'deny' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD'].includes(req.method) || /^\/api(?:\/|$)/.test(req.path) || extname(req.path) || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(index);
  });
}
