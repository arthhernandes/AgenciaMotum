import { PrismaService } from '../../prisma/prisma.service';
// Store stock is already loaded from its own Bling connection.
export async function applySharedStock(_prisma: PrismaService, records: any[]) { return records; }
