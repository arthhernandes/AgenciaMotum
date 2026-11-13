import { Controller, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { BlingSyncService } from './bling-sync.service';

@ApiTags('bling-sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sync/bling')
export class BlingSyncController {
  constructor(private readonly sync: BlingSyncService) {}

  @Post()
  run(@Query('marketplaceAccountId') marketplaceAccountId?: string) {
    return this.sync.sync(undefined, marketplaceAccountId);
  }

  @Post('new-today')
  newToday(@Query('marketplaceAccountId') marketplaceAccountId?:string){return this.sync.syncNewToday(marketplaceAccountId);}

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    return this.sync.pause(id);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string) {
    return this.sync.resume(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.sync.cancel(id);
  }
}
