import {invoke,isTauri} from '@tauri-apps/api/core';
import contract from './contract.json';

export type Context={screen?:string;company?:string;workspace?:string;entity?:string;readOnly?:boolean;role?:string;phase?:string;reason?:string;durationMs?:number;count?:number;bytes?:number;fields?:string[]};
export type DiagnosticEvent=Context&{operation:string;outcome:string};
export type Session={sessionId:string;state:'active'|'stopped'|'interrupted';startedMs:number;endedMs:number|null;eventCount:number;droppedEvents:number;launch:string;failure:string|null};
export type Status={current:Session|null;sessions:Session[];failure:string|null};
type Transport=<T>(command:string,args?:Record<string,unknown>)=>Promise<T>;
const empty=():Status=>({current:null,sessions:[],failure:null});
const matches=(group:keyof typeof contract,value:unknown):value is string=>typeof value==='string'&&Array.isArray(contract[group])&&(contract[group] as string[]).includes(value);
// Drop values, raw errors, filenames and arbitrary objects at the first boundary.
export function safeEvent(operation:string,outcome:string,context:Context={}):DiagnosticEvent|null{
 if(!matches('operations',operation)||!matches('outcomes',outcome))return null;
 const event:DiagnosticEvent={operation,outcome};
 for(const key of ['screen','phase','reason'] as const){const group=key==='screen'?'screens':key==='phase'?'phases':'reasons';if(matches(group,context[key]))event[key]=context[key];}
 for(const key of ['company','workspace','entity'] as const)if(typeof context[key]==='string')event[key]=context[key]!.slice(0,512);
 if(['member','manager','administrator'].includes(context.role??''))event.role=context.role;
 if(typeof context.readOnly==='boolean')event.readOnly=context.readOnly;
 for(const key of ['durationMs','count','bytes'] as const)if(Number.isFinite(context[key])&&context[key]!>=0)event[key]=Math.min(Math.floor(context[key]!),1_000_000_000);
 if(Array.isArray(context.fields))event.fields=context.fields.filter(f=>matches('fields',f)).slice(0,32);
 return event;
}
export function reasonCode(error:unknown):string{
 try{const code=typeof error==='object'&&error!==null&&'code'in error?String(error.code):typeof error==='string'?error:error instanceof Error?error.message:'';
 const normalized=code.replace(/^(auth|functions|storage)\//,'').replaceAll('-','_').toUpperCase();return matches('reasons',normalized)?normalized:'OPERATION_FAILED';}catch{return 'OPERATION_FAILED';}
}
export class DiagnosticClient{
 status:Status=empty();context:Context={screen:'entry'};failure='';private queue:DiagnosticEvent[]=[];private dropped=0;private timer:ReturnType<typeof setTimeout>|null=null;private sending:Promise<void>|null=null;
 constructor(private transport:Transport,private available=()=>true){}
 get active(){return this.status.current?.state==='active';}
 async refresh(){if(!this.available())return this.status;try{this.status=await this.transport<Status>('diagnostic_status');}catch{this.failure='Diagnostics is unavailable. Your work can continue.';}return this.status;}
 emit(operation:string,outcome:string,context:Context={}){
  try{if(!this.active)return;const event=safeEvent(operation,outcome,{...this.context,...context});if(!event)return;
   if(this.queue.length>=256){this.dropped++;return;}this.queue.push(event);if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;void this.flush();},100);
  }catch{this.failure='A diagnostic event could not be recorded.';}
 }
 async flush():Promise<void>{
  if(this.timer){clearTimeout(this.timer);this.timer=null;}if(this.sending){await this.sending;if(this.queue.length)return this.flush();return;}
  this.sending=(async()=>{while(this.queue.length||this.dropped){const events=this.queue.splice(0,64),dropped=this.dropped;this.dropped=0;try{await this.transport('diagnostic_events',{events,dropped});}catch{this.dropped+=events.length+dropped+this.queue.length;this.failure=`Some diagnostic events could not be saved (${this.dropped} pending drop reports).`;this.queue=[];break;}}})();
  try{await this.sending;}finally{this.sending=null;}
 }
 async start(){await this.flush();await this.transport('diagnostic_start');await this.refresh();this.emit('navigation','changed');}
 async stop(){await this.flush();await this.transport('diagnostic_stop');await this.refresh();}
 async mark(){if(!this.active)return;await this.flush();await this.transport('diagnostic_mark',{context:safeEvent('diagnostics','marked',this.context)});await this.refresh();}
 async export(sessionId:string){await this.flush();return this.transport<{filename:string}>('diagnostic_export',{sessionId});}
 async openExports(){await this.transport('diagnostic_open_exports');}
 async observe<T>(operation:string,work:()=>Promise<T>,context:Context={}):Promise<T>{
  const started=performance.now();this.emit(operation,'started',context);
  try{const result=await work();this.emit(operation,'succeeded',{...context,durationMs:performance.now()-started});return result;}
  catch(error){this.emit(operation,reasonCode(error)==='CANCELLED'?'cancelled':'failed',{...context,reason:reasonCode(error),durationMs:performance.now()-started});throw error;}
 }
}
export const diagnostics=new DiagnosticClient(invoke,isTauri);
export function observe<T>(operation:string,work:()=>Promise<T>,context:Context={}){return diagnostics.observe(operation,work,context);}
export function screenContext(label:string){const mapping:Record<string,string>={'Management Home':'management-home','Work Areas':'work-areas','Chemical Library':'chemical-library','Workers':'workers','Assignments & Training':'assignments-training','Reports & Export':'reports-export','Company & Access Administration':'company-access-administration','SDS Batch Import':'sds-batch-import','Trash':'trash'};diagnostics.context.screen=mapping[label]??'unknown';diagnostics.emit('navigation','changed');}
export function instrumentAuthoring<T extends object>(service:T):T{
 return new Proxy(service,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);if(typeof value!=='function')return value;
  const fixed:Record<string,string>={snapshot:'snapshot',importSds:'sds.import',readSds:'sds.read',unlinkSds:'sds.unlink',importSdsBatch:'sds_batch.import',splitSdsImportDraft:'sds_batch.split',mergeSdsImportDraft:'sds_batch.merge',saveSdsImportDrafts:'sds_batch.review_save'};
  if(!['create','update','trash',...Object.keys(fixed)].includes(String(key)))return value;
  return (...args:unknown[])=>{let operation=fixed[String(key)],context:Context={};
   if(['create','update','trash'].includes(String(key))){operation=String(args[0])+'.'+(key==='trash'?(args[2]?'restore':'trash'):String(key));context.entity=typeof args[key==='create'?2:1]==='string'?args[key==='create'?2:1] as string:undefined;const input=args[key==='create'?1:2];if(key!=='trash'&&input&&typeof input==='object')context.fields=Object.keys(input);}
   else if(key==='importSds'||key==='readSds'||key==='unlinkSds')context.entity=String(args[0]);
   if(key==='importSds'||key==='importSdsBatch'){const bytes=args[key==='importSds'?1:0];if(bytes instanceof Uint8Array)context.bytes=bytes.byteLength;}
   return observe(operation,()=>Reflect.apply(value,target,args),context);
  };
 }});
}

export function diagnosticHotkey(event:KeyboardEvent,active:boolean):'open'|'mark'|null{
 if(event.repeat||event.isComposing||event.metaKey)return null;
 if(event.ctrlKey&&event.shiftKey&&event.altKey&&event.code==='KeyD')return 'open';
 if(active&&event.ctrlKey&&event.shiftKey&&!event.altKey&&event.code==='KeyM')return 'mark';return null;
}
