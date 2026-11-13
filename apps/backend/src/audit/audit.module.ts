import { Module } from '@nestjs/common';
import { AuditRetentionService } from './audit-retention.service';
import { AuditController } from './audit.controller';
import { AuditEngineService } from './audit-engine.service';
import { AuditService } from './audit.service';

@Module({ controllers: [AuditController], providers: [AuditService, AuditEngineService, AuditRetentionService], exports: [AuditService, AuditEngineService] })
export class AuditModule {}
