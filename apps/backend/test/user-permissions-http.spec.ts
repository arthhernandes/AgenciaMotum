import { Controller, Get, INestApplication, Post, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
const request=require('supertest');
import { JwtAuthGuard } from '../src/auth/jwt.guard';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { UsersService } from '../src/users/users.service';
import { CostVisibilityInterceptor } from '../src/auth/cost-visibility';

@Controller() @UseGuards(JwtAuthGuard)
class PermissionFixtureController {
  @Get('listings/grouped') listings(){return {ok:true,price:199.9,cost:45.9};}
  @Post('products/:id/costs') costs(){return {rows:[{sku:'1.1',cost:45.9}]};}
  @Post('chat/listing-editor/prepare') edit(){return {ok:true};}
  @Post('sync/bling') sync(){return {ok:true};}
  @Post('operations/fiscal-templates') fiscal(){return {ok:true};}
  @Get('users') users(){return {ok:true};}
  @Get('auth/me') me(){return {ok:true};}
  @Get('bling/auth/authorize') connect(){return {ok:true};}
}
describe('JWT permission enforcement over HTTP',()=>{
  let app:INestApplication,jwt:JwtService;
  let current:any={id:'u',active:true,email:'user@example.com',role:'CONSULTANT',permissions:['listings.view']};
  beforeAll(async()=>{
    const module=await Test.createTestingModule({imports:[PassportModule,JwtModule.register({secret:'test-permissions'})],controllers:[PermissionFixtureController],providers:[JwtStrategy,{provide:ConfigService,useValue:new ConfigService({JWT_SECRET:'test-permissions'})},{provide:UsersService,useValue:{findById:()=>Promise.resolve(current)}}]}).compile();
    app=module.createNestApplication();app.setGlobalPrefix('api');app.useGlobalInterceptors(new CostVisibilityInterceptor());await app.init();jwt=module.get(JwtService);
  });
  afterAll(async()=>app.close());
  const auth=()=>({Authorization:'Bearer '+jwt.sign({sub:'u',email:'old@example.com',role:'ADMIN'})});
  it('allows reading but rejects writes and user management even with an old ADMIN claim',async()=>{
    await request(app.getHttpServer()).get('/api/listings/grouped?marketplaceAccountId=store-test').set(auth()).expect(200);
    await request(app.getHttpServer()).post('/api/chat/listing-editor/prepare?marketplaceAccountId=store-test').set(auth()).expect(403);
    await request(app.getHttpServer()).post('/api/sync/bling?marketplaceAccountId=store-test').set(auth()).expect(403);
    await request(app.getHttpServer()).get('/api/users?marketplaceAccountId=store-test').set(auth()).expect(403);
    await request(app.getHttpServer()).get('/api/bling/auth/authorize?marketplaceAccountId=store-test').set(auth()).expect(403);
  });
  it('grants only the newly selected actions without a new login',async()=>{
    current={...current,role:'VIEWER',permissions:['templates.view','templates.manage']};
    await request(app.getHttpServer()).post('/api/operations/fiscal-templates?marketplaceAccountId=store-test').set(auth()).expect(201);
    await request(app.getHttpServer()).post('/api/chat/listing-editor/prepare?marketplaceAccountId=store-test').set(auth()).expect(403);
    await request(app.getHttpServer()).get('/api/listings/grouped?marketplaceAccountId=store-test').set(auth()).expect(403);
  });
  it('hides cost values on the server and releases them only with the new permission',async()=>{
    current={...current,active:true,permissions:['listings.view','map.view']};
    const response=await request(app.getHttpServer()).get('/api/listings/grouped?marketplaceAccountId=store-test').set(auth()).expect(200);
    expect(response.body).toEqual({ok:true,price:199.9});
    await request(app.getHttpServer()).post('/api/products/product/costs?marketplaceAccountId=store-test').set(auth()).expect(403);
    current={...current,permissions:['listings.view','map.view','costs.view']};
    const allowed=await request(app.getHttpServer()).post('/api/products/product/costs?marketplaceAccountId=store-test').set(auth()).expect(201);expect(allowed.body.rows[0].cost).toBe(45.9);
  });
  it('revokes access using the same valid token and keeps auth/me available for an empty permission set',async()=>{
    const token=auth();current={...current,permissions:[]};
    await request(app.getHttpServer()).post('/api/operations/fiscal-templates?marketplaceAccountId=store-test').set(token).expect(403);
    await request(app.getHttpServer()).get('/api/auth/me?marketplaceAccountId=store-test').set(token).expect(200);
    current={...current,active:false};await request(app.getHttpServer()).get('/api/auth/me?marketplaceAccountId=store-test').set(token).expect(401);
  });
});
