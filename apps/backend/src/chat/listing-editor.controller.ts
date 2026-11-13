import { FileInterceptor } from '@nestjs/platform-express';
import { Body, Controller, Get, Param, Post, Query, Req, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ListingEditorDto } from './listing-editor.dto';
import { ListingEditorService } from './listing-editor.service';
@Controller('chat/listing-editor')
@UseGuards(JwtAuthGuard)
export class ListingEditorController {
  constructor(private readonly editor:ListingEditorService){}
  @Get() read(@Query('marketplaceAccountId') accountId:string,@Query('reference') reference:string){return this.editor.read(accountId,reference);}
  @Post('photos/upload')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1,fields:1}}))
  uploadPhoto(@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}},@Body('reference') reference:string,@UploadedFile() file?:{buffer:Buffer;mimetype:string;originalname:string}){return this.editor.uploadPhoto(accountId,req.user.id,reference,file);}
  @Post('prepare') prepare(@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}},@Body() body:ListingEditorDto){return this.editor.prepare(accountId,req.user.id,body);}
  @Post(':id/confirm') confirm(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){return this.editor.confirm(accountId,req.user.id,id);}
  @Post(':id/cancel') cancel(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string,@Req() req:{user:{id:string}}){return this.editor.cancel(accountId,req.user.id,id);}
}
