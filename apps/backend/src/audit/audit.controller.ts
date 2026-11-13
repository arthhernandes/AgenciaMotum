import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PaginationQuery } from '../common/pagination';
import { AuditEngineService } from './audit-engine.service';
import { AuditService } from './audit.service';
import { AdsAuditQuery } from './dto';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService, private readonly engine: AuditEngineService) {}

  @Get('issues')
  issues(@Query() query: PaginationQuery & { type?: never; severity?: never; status?: string; sku?: string }) {
    return this.audit.findIssues(query);
  }

  @Get('ads')
  ads(@Query() query: AdsAuditQuery) {
    return this.audit.findAdsAudit(query);
  }

  @Get('issues/:id')
  issue(@Param('id') id: string) {
    return id;
  }

  @Post('run')
  run() {
    return this.engine.run();
  }
}
