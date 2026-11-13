import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { effectivePermissions } from './permissions';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly users:UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev-secret')
    });
  }

  async validate(payload: JwtPayload) {
    const user=await this.users.findById(payload.sub);
    if(!user?.active)throw new UnauthorizedException('Seu acesso está desativado.');
    return { id: user.id, email: user.email, name:user.name, role: user.role, permissions:effectivePermissions(user) };
  }
}
