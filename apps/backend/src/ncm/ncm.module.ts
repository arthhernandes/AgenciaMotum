import {BadRequestException,Controller,Get,Module,NotFoundException,Param,Query,UseGuards} from '@nestjs/common';
import {JwtAuthGuard} from '../auth/jwt.guard';
import {PrismaService} from '../prisma/prisma.service';
import {normalizeNcmSearch} from './ncm-catalog';
@Controller('ncm') @UseGuards(JwtAuthGuard)
export class NcmController {
 constructor(private readonly prisma:PrismaService){}
 @Get() async search(@Query('search') search='',@Query('page') pageValue='1',@Query('limit') limitValue='25',@Query('includeHierarchy') hierarchy='false'){
  const page=Number(pageValue),limit=Number(limitValue);
  if(typeof search!=='string'||search.length>200||!Number.isInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100||!['true','false'].includes(hierarchy))throw new BadRequestException('Parâmetros de consulta NCM inválidos.');
  const tokens=normalizeNcmSearch(search).split(' ').filter(Boolean);
  const codeSearch=/^\d[\d.\s]*$/.test(search.trim())?search.replace(/[.\s]/g,''):null;
  const where={...(hierarchy==='true'?{}:{level:8}),...(codeSearch?{code:{startsWith:codeSearch}}:{AND:tokens.map(token=>({searchText:{contains:token}}))})};
  const [data,total]=await Promise.all([this.prisma.ncmEntry.findMany({where,orderBy:{code:'asc'},skip:(page-1)*limit,take:limit}),this.prisma.ncmEntry.count({where})]);
  return {data,pagination:{page,limit,total,pages:Math.ceil(total/limit)}};
 }
 @Get(':code') async get(@Param('code') rawCode:string){const code=rawCode.replace(/\./g,'');if(!/^\d{2,8}$/.test(code))throw new BadRequestException('Código NCM inválido.');const entry=await this.prisma.ncmEntry.findUnique({where:{code}});if(!entry)throw new NotFoundException('Código não encontrado na tabela NCM importada.');const parents=[];let parent=entry.parentCode;while(parent){const record=await this.prisma.ncmEntry.findUnique({where:{code:parent}});if(!record)break;parents.unshift(record);parent=record.parentCode;}return {...entry,parents};}
}
@Module({controllers:[NcmController]})
export class NcmModule{}
