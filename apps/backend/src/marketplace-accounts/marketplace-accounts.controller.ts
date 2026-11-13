import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CreateMarketplaceAccountDto, CreateStoreDto } from './dto';
import { MarketplaceAccountsService } from './marketplace-accounts.service';

@ApiTags('marketplace-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('marketplace-accounts')
export class MarketplaceAccountsController {
  constructor(private readonly accounts: MarketplaceAccountsService) {}

  @Get()
  findAll(@Query('marketplaceAccountId') marketplaceAccountId?: string) {
    return this.accounts.findAll(marketplaceAccountId);
  }

  @Get('business')
  findBusinessAccounts() {
    return this.accounts.findBusinessAccounts();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.accounts.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateMarketplaceAccountDto, @Query('marketplaceAccountId') accountId?: string) {
    return this.accounts.create(dto, accountId);
  }

  @Post('business')
  createStore(@Body() dto: CreateStoreDto, @Req() req: { user: { role: string } }) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('Apenas o administrador master pode criar lojas.');
    return this.accounts.createStore(dto.name);
  }

  @Post(':id/disconnect')
  disconnect(@Param('id') id:string,@Query('marketplaceAccountId') accountId:string){return this.accounts.disconnect(id,accountId);}
}
