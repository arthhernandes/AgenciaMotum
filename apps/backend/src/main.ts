import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/global-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';
import { corsOrigins } from './common/cors-origins';
import { resolve } from 'node:path';
import { configureFrontend } from './common/frontend-hosting';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useBodyParser('json',{limit:'8mb'});
  app.setGlobalPrefix('api');
  app.use(helmet());
  const config = app.get(ConfigService);
  if (config.get<string>('SERVE_FRONTEND') === 'true') {
    configureFrontend(app, resolve(config.get<string>('FRONTEND_DIST_PATH') || resolve(__dirname, '../../../frontend/dist/frontend/browser')));
  }
  app.enableShutdownHooks();
  app.enableCors({ origin: corsOrigins(config.get<string>('FRONTEND_URL'),config.get<string>('CORS_ORIGINS')), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Bling Mercado Livre Audit API')
    .setDescription('Controle e auditoria de anúncios do Mercado Livre relacionados à Bling')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = Number(config.get<string>('PORT') || config.get<string>('API_PORT') || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT/API_PORT inválida.');
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
