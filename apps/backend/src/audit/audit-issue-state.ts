import { isDeepStrictEqual } from 'node:util';
import { AuditIssueType, AuditSeverity, Prisma } from '@prisma/client';

export const AUDIT_LOCK = 71261112;
export const ISSUE_RETENTION_DAYS = 90;
export type IssueCandidate = {
  type: AuditIssueType; severity: AuditSeverity; title: string; description: string;
  productId?: string | null; productVariantId?: string | null;
  listingId?: string | null; listingVariantId?: string | null;
  marketplaceAccountId?: string | null; metadata?: Prisma.InputJsonValue;
};
export type StoredIssue = Pick<IssueCandidate, 'type' | 'productId' | 'productVariantId' | 'listingId' | 'listingVariantId' | 'marketplaceAccountId'> & {
  id: string; resolved: boolean; updatedAt: Date;
  severity?: AuditSeverity; title?: string; description?: string; metadata?: Prisma.InputJsonValue | null;
};
const refs = ['productId','productVariantId','listingId','listingVariantId','marketplaceAccountId'] as const;
export function issueIdentity<T extends Pick<IssueCandidate,'type'|'productId'|'productVariantId'|'listingId'|'listingVariantId'|'marketplaceAccountId'>>(issue: T): string {
  return JSON.stringify([issue.type,...refs.map(field=>issue[field]??null)]);
}
export function planIssueState(existing: StoredIssue[], candidates: IssueCandidate[]) {
  const desired = new Map(candidates.map(issue=>[issueIdentity(issue),issue]));
  const current = new Map<string,StoredIssue>();
  const duplicates: string[] = [];
  // Prefer an open issue; never discard a pending problem in favor of history.
  for (const issue of [...existing].sort((a,b)=>Number(a.resolved)-Number(b.resolved)||b.updatedAt.getTime()-a.updatedAt.getTime()||b.id.localeCompare(a.id))) {
    // Deleted references cannot safely identify two historical issues as the same.
    const key = refs.some(field=>issue[field]!=null) ? issueIdentity(issue) : 'orphan:'+issue.id;
    if (current.has(key)) duplicates.push(issue.id); else current.set(key,issue);
  }
  const create: IssueCandidate[] = [];
  const update: Array<IssueCandidate & {id:string}> = [];
  const resolve: string[] = [];
  let unchanged=0;
  for (const [key,issue] of desired) {
    const previous=current.get(key);
    if(!previous)create.push(issue);
    else if(!previous.resolved&&previous.severity===issue.severity&&previous.title===issue.title&&previous.description===issue.description&&isDeepStrictEqual(previous.metadata??null,issue.metadata??null))unchanged++;
    else update.push({...issue,id:previous.id});
  }
  for (const [key,issue] of current) if(!issue.resolved&&!desired.has(key))resolve.push(issue.id);
  return {create,update,resolve,duplicates,unchanged,active:desired.size};
}
export async function persistIssueState(tx: Prisma.TransactionClient, candidates: IssueCandidate[], now: Date) {
  const existing=await tx.auditIssue.findMany({select:{id:true,type:true,productId:true,productVariantId:true,listingId:true,listingVariantId:true,marketplaceAccountId:true,resolved:true,updatedAt:true,severity:true,title:true,description:true,metadata:true}});
  const plan=planIssueState(existing,candidates);
  for(let i=0;i<plan.duplicates.length;i+=5000)await tx.auditIssue.deleteMany({where:{id:{in:plan.duplicates.slice(i,i+5000)}}});
  for(let i=0;i<plan.resolve.length;i+=5000)await tx.auditIssue.updateMany({where:{id:{in:plan.resolve.slice(i,i+5000)},resolved:false},data:{resolved:true,resolvedAt:now}});
  for(let i=0;i<plan.create.length;i+=500)await tx.auditIssue.createMany({data:plan.create.slice(i,i+500).map(issue=>({...issue,metadata:issue.metadata??Prisma.DbNull,createdAt:now,updatedAt:now}))});
  for(let i=0;i<plan.update.length;i+=500){
    const rows=plan.update.slice(i,i+500).map(issue=>({id:issue.id,severity:issue.severity,title:issue.title,description:issue.description,metadata:issue.metadata??null}));
    await tx.$executeRaw`UPDATE "AuditIssue" AS a SET severity=x.severity::"AuditSeverity", title=x.title, description=x.description, metadata=x.metadata, resolved=false, "resolvedAt"=NULL, "resolvedBy"=NULL, "updatedAt"=${now}
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(id text,severity text,title text,description text,metadata jsonb) WHERE a.id=x.id`;
  }
  return {active:plan.active,inserted:plan.create.length,updated:plan.update.length,unchanged:plan.unchanged,resolved:plan.resolve.length,duplicatesRemoved:plan.duplicates.length};
}
