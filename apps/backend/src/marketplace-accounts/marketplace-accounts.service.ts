import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMarketplaceAccountDto } from './dto';
import { ConnectionStatusService } from './connection-status.service';
import { randomUUID } from 'crypto';

@Injectable()
export class MarketplaceAccountsService {
  constructor(private readonly prisma: PrismaService,private readonly connection:ConnectionStatusService) {}

  async findAll(selectedBlingAccountId?: string) {
    const selectedBling = selectedBlingAccountId
      ? await this.prisma.marketplaceAccount.findFirst({ where: { id: selectedBlingAccountId, marketplace: 'BLING' }, select: { businessKey: true } })
      : null;
    if (!selectedBling) return [];
    const businessKey = selectedBling.businessKey;
    const accounts = await this.prisma.marketplaceAccount.findMany({
      where: { marketplace: 'MERCADO_LIVRE', businessKey },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        marketplace: true,
        name: true,
        sellerId: true,
        nickname: true,
        accessToken: true,
        refreshToken: true,
        tokenExpiresAt: true,
        active: true,
        createdAt: true,
        updatedAt: true
      }
    });
    return Promise.all(accounts.map(async raw => {
      const {accessToken,refreshToken,...account}=raw;
      return {...account,configured:true,hasCredentials:Boolean(accessToken||refreshToken),...await this.connection.verify(raw)};
    }));
  }

  findBusinessAccounts() {
    return this.prisma.marketplaceAccount.findMany({
      where: { marketplace: 'BLING', active: true },
      orderBy: [{ sellerId: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true }
    }).then((accounts) => accounts.map((account) => ({
      id: account.id,
      displayName: account.name
    })));
  }

  findOne(id: string) {
    return this.prisma.marketplaceAccount.findUnique({
      where: { id },
      select: {
        id: true,
        marketplace: true,
        name: true,
        sellerId: true,
        nickname: true,
        accessToken: true,
        refreshToken: true,
        tokenExpiresAt: true,
        active: true,
        createdAt: true,
        updatedAt: true
      }
    }).then(async (account) => {
      if (!account) return null;
      const { accessToken, refreshToken, ...safeAccount } = account;
      return {
        ...safeAccount,
        configured: true,
        hasCredentials: Boolean(accessToken || refreshToken),
        ...await this.connection.verify(account)
      };
    });
  }

  async create(dto: CreateMarketplaceAccountDto, selectedAccountId?: string) {
    if (dto.marketplace !== 'MERCADO_LIVRE' || !selectedAccountId) throw new BadRequestException('Selecione uma loja para adicionar a conta Mercado Livre.');
    const store = await this.prisma.marketplaceAccount.findFirst({ where: { id: selectedAccountId, marketplace: 'BLING', active: true } });
    if (!store) throw new BadRequestException('Loja não encontrada.');
    const account = await this.prisma.marketplaceAccount.create({ data: { ...dto, businessKey: store.businessKey } });
    return { id: account.id, name: account.name, marketplace: account.marketplace };
  }

  async createStore(name: string) {
    const displayName = name.trim();
    if (!displayName) throw new BadRequestException('Informe o nome da loja.');
    const businessKey = randomUUID();
    const store = await this.prisma.$transaction(async tx => {
      const business = await tx.marketplaceAccount.create({ data: { marketplace: 'BLING', name: displayName, sellerId: businessKey, businessKey } });
      await tx.marketplaceAccount.create({ data: { marketplace: 'MERCADO_LIVRE', name: displayName + ' · Mercado Livre', sellerId: 'PENDING_' + businessKey, businessKey } });
      return business;
    });
    return { id: store.id, displayName: store.name };
  }

  async disconnect(id:string,selectedBlingAccountId:string){
    if(!selectedBlingAccountId)throw new BadRequestException('Selecione a conta da operação.');
    const selected=await this.prisma.marketplaceAccount.findFirst({where:{id:selectedBlingAccountId,marketplace:'BLING'},select:{businessKey:true}});
    if(!selected)throw new NotFoundException('Conta da operação não encontrada.');
    const result=await this.prisma.marketplaceAccount.updateMany({where:{id,businessKey:selected.businessKey,marketplace:{in:['BLING','MERCADO_LIVRE']}},data:{accessToken:null,refreshToken:null,tokenExpiresAt:null}});
    if(!result.count)throw new NotFoundException('Conta não encontrada nesta operação.');
    return {disconnected:true};
  }
}
