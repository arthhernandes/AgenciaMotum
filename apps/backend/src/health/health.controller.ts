import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    let postgres = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      postgres = 'error';
    }

    return { api: 'ok', postgres };
  }
}
