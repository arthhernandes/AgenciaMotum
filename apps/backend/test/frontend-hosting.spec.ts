import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureFrontend } from '../src/common/frontend-hosting';
const request = require('supertest');

@Controller('health')
class Health { @Get() check() { return {api:'ok'}; } }
@Module({controllers:[Health]})
class TestModule {}

describe('Hostinger single-domain hosting', () => {
  let app: INestApplication, directory: string;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'motum-hosting-'));
    writeFileSync(join(directory, 'index.html'), '<html>Angular application</html>');
    writeFileSync(join(directory, 'main.js'), 'window.loaded=true;');
    const server = await NestFactory.create<NestExpressApplication>(TestModule, {logger:false});
    server.setGlobalPrefix('api');
    configureFrontend(server, directory);
    app = server;
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    if (directory) {
      unlinkSync(join(directory, 'index.html'));
      unlinkSync(join(directory, 'main.js'));
      rmdirSync(directory);
    }
  });
  it.each(['/', '/contas', '/anuncios'])('serves the SPA for a browser visit to %s', async path => {
    const res = await request(app.getHttpServer()).get(path).set('Accept','text/html').expect(200);
    expect(res.text).toContain('Angular application');
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('serves compiled assets', async () => {
    const res = await request(app.getHttpServer()).get('/main.js').expect(200);
    expect(res.text).toBe('window.loaded=true;');
  });
  it('keeps API routing separate from the SPA', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200,{api:'ok'});
    const res = await request(app.getHttpServer()).get('/api/missing').set('Accept','text/html').expect(404);
    expect(res.text).not.toContain('Angular application');
  });
  it('returns 404 for missing assets and non-browser requests', async () => {
    await request(app.getHttpServer()).get('/missing.js').expect(404);
    await request(app.getHttpServer()).get('/contas').set('Accept','application/json').expect(404);
    await request(app.getHttpServer()).post('/contas').expect(404);
  });
  it('fails startup when the production frontend is missing', () => {
    expect(() => configureFrontend({} as any, join(directory,'missing'))).toThrow('Frontend compilado');
  });
});
