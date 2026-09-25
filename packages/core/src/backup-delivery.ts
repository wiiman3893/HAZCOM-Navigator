export const DEFAULT_BACKUP_ATTACHMENT_THRESHOLD=15*1024*1024;
export interface BackupToken {id:string;purpose:'verify_backup_email'|'download_backup';companyId:string;email:string;sha256:string;expiresAt:number;consumedAt:number|null;}
export interface IssuedBackupToken {token:string;record:BackupToken;}
const validId=(id:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(id);
const validEmail=(email:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
async function sha256(value:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function backupDeliveryMode(sizeBytes:number,threshold=DEFAULT_BACKUP_ATTACHMENT_THRESHOLD):'attachment'|'link'{if(!Number.isSafeInteger(sizeBytes)||sizeBytes<0||!Number.isSafeInteger(threshold)||threshold<0)throw Error('Invalid backup size');return sizeBytes<=threshold?'attachment':'link';}
export async function issueBackupToken(purpose:BackupToken['purpose'],companyId:string,email:string,now=Date.now(),ttlMs=15*60*1000):Promise<IssuedBackupToken>{
 if(!validId(companyId)||!validEmail(email)||!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>86400000)throw Error('Invalid backup token request');
 const bytes=crypto.getRandomValues(new Uint8Array(32)),token=Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
 return {token,record:{id:crypto.randomUUID(),purpose,companyId,email:email.toLowerCase(),sha256:await sha256(token),expiresAt:now+ttlMs,consumedAt:null}};
}
export async function redeemBackupToken(record:BackupToken,token:string,purpose:BackupToken['purpose'],companyId:string,now=Date.now()):Promise<BackupToken>{
 if(record.purpose!==purpose||record.companyId!==companyId||record.consumedAt!==null||now>=record.expiresAt||!token||await sha256(token)!==record.sha256)throw Error('Backup token is invalid or expired');
 return {...record,consumedAt:now};
}

export interface BackupDeliveryMessage {to:string;companyId:string;mode:'attachment'|'link';attachment?:Uint8Array;token?:string;expiresAt?:number;}
export interface BackupDeliveryTransport {send(message:BackupDeliveryMessage):Promise<void>;}
/** Test/dev delivery adapter. Caller must verify that email is the authoritative Company backup address. */
export class InMemoryBackupDelivery {
 private readonly links=new Map<string,{record:BackupToken;bytes:Uint8Array}>();
 constructor(private readonly transport:BackupDeliveryTransport,private readonly threshold=DEFAULT_BACKUP_ATTACHMENT_THRESHOLD){}
 async deliver(companyId:string,email:string,bytes:Uint8Array,now=Date.now()){
  if(!validId(companyId)||!validEmail(email)||!(bytes instanceof Uint8Array))throw Error('Invalid backup delivery request');
  const mode=backupDeliveryMode(bytes.length,this.threshold);
  if(mode==='attachment'){await this.transport.send({to:email,companyId,mode,attachment:bytes.slice()});return {mode};}
  const issued=await issueBackupToken('download_backup',companyId,email,now);
  this.links.set(issued.record.id,{record:issued.record,bytes:bytes.slice()});
  await this.transport.send({to:email,companyId,mode,token:issued.token,expiresAt:issued.record.expiresAt});
  return {mode,expiresAt:issued.record.expiresAt};
 }
 async deliverForVerifiedCompany(company:{id:string;backupEmail:string;backupEmailVerified:boolean;coverageStatus:'active'|'grace'|'ending'|'expired'},requestingEmail:string,bytes:Uint8Array,now=Date.now()){
  if(!company.backupEmailVerified||company.coverageStatus==='expired'||company.backupEmail.toLowerCase()!==requestingEmail.toLowerCase())throw Error('Backup holder or coverage is not authorized');
  return this.deliver(company.id,requestingEmail,bytes,now);
 }
 async download(companyId:string,token:string,now=Date.now()):Promise<Uint8Array>{
  for(const [id,item] of this.links){
   if(item.record.companyId!==companyId)continue;
   try{await redeemBackupToken(item.record,token,'download_backup',companyId,now);this.links.delete(id);return item.bytes.slice();}catch{}
  }
  throw Error('Backup link is invalid or expired');
 }
}
