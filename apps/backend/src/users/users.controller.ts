import { ActivityService } from './activity.service';
import { ActivityQuery } from './activity-query';
import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PERMISSION_AREAS, PERMISSION_KEYS, defaultPermissions } from '../auth/permissions';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { UsersService } from './users.service';

export class SaveUserDto {
  @IsString() @Transform(({value})=>typeof value==='string'?value.trim():value) @Length(2,120) name!:string;
  @IsEmail() @MaxLength(254) @Transform(({value})=>typeof value==='string'?value.trim().toLowerCase():value) email!:string;
  @IsEnum(UserRole) role!:UserRole;
  @IsBoolean() active!:boolean;
  @IsOptional() @IsString() @Length(8,72) password?:string;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @ArrayUnique() @IsIn(PERMISSION_KEYS,{each:true}) permissions?:string[];
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users:UsersService, private readonly activity:ActivityService){}
  @Get('activity') history(@Request() req:any,@Query() query:ActivityQuery){return this.activity.list(req.user.id,query);}
  @Get('permission-options') options(){return {areas:PERMISSION_AREAS,defaults:{ADMIN:defaultPermissions('ADMIN'),CONSULTANT:defaultPermissions('CONSULTANT'),VIEWER:defaultPermissions('VIEWER')}};}
  @Get() list(@Request() req:any){return this.users.listManaged(req.user.id);}
  @Post() create(@Request() req:any,@Body() dto:SaveUserDto){return this.users.saveManaged(req.user.id,dto);}
  @Post(':id') update(@Request() req:any,@Param('id') id:string,@Body() dto:SaveUserDto){return this.users.saveManaged(req.user.id,dto,id);}
}
