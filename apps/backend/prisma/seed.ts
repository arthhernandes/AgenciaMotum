import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
const envFile = ['.env', '../../.env'].find(file => existsSync(file));
if (envFile) loadEnvFile(envFile);
const prisma = new PrismaClient();
async function main() {
  const email = process.env.MASTER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.MASTER_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error('Configure MASTER_ADMIN_EMAIL e MASTER_ADMIN_PASSWORD (mínimo 12 caracteres).');
  await prisma.user.upsert({where:{email},update:{},create:{email,name:process.env.MASTER_ADMIN_NAME || 'Administrador master',passwordHash:await bcrypt.hash(password,12),role:UserRole.ADMIN}});
  // Stores are created explicitly by the master administrator in the application.
}
main().then(()=>prisma.$disconnect()).catch(async error=>{console.error(error.message);await prisma.$disconnect();process.exit(1);});
