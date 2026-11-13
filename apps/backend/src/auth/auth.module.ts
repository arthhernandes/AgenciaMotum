import { Global, Module } from '@nestjs/common';
import { OAuthStateService } from './oauth-state.service';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';

@Global()
@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-secret'),
        signOptions: { expiresIn: '8h' }
      })
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, OAuthStateService],
  exports: [AuthService, OAuthStateService]
})
export class AuthModule {}
