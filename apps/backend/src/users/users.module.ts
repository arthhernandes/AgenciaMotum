import { ActivityService } from './activity.service';
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService, ActivityService],
  exports: [UsersService]
})
export class UsersModule {}
