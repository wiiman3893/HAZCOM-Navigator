/** Versioned development catalog. Paid Company entity ceilings are deliberately unset. */
export type Cadence='monthly'|'annual';
export type PlanFamily='demo'|'company'|'pro';
export type DemoType='company'|'pro';
export type CommercialStatus='active'|'grace'|'expired';
export interface Capabilities {
 maxCoveredCompanies:number; maxChemicalProductsPerCompany:number|null; maxWorkersPerCompany:number|null;
 maxWorkAreasPerCompany:number|null; maxProSeats:number;
 canPublish:boolean; canInviteCompanyMembers:boolean; canCreateCompanies:boolean;
 canExportBackup:boolean; canManageCompanySettings:boolean; canUseProTeam:boolean;
 canAuthor:boolean; canReadPublished:boolean;
}
export interface CatalogPlan {
 id:string; family:PlanFamily; demoType?:DemoType; version:string; displayName:string;
 limits:Pick<Capabilities,'maxCoveredCompanies'|'maxChemicalProductsPerCompany'|'maxWorkersPerCompany'|'maxWorkAreasPerCompany'|'maxProSeats'>;
 monthlyUsdCents?:number; annualUsdCents?:number; additionalSeatMonthlyUsdCents?:number; additionalSeatAnnualUsdCents?:number;
}
export const DEVELOPMENT_CATALOG:Readonly<Record<string,CatalogPlan>>=Object.freeze({
 demo_company:{id:'demo_company',family:'demo',demoType:'company',version:'v1',displayName:'Company Demo',limits:{maxCoveredCompanies:1,maxChemicalProductsPerCompany:3,maxWorkersPerCompany:1,maxWorkAreasPerCompany:2,maxProSeats:0}},
 demo_pro:{id:'demo_pro',family:'demo',demoType:'pro',version:'v1',displayName:'Pro Demo',limits:{maxCoveredCompanies:3,maxChemicalProductsPerCompany:3,maxWorkersPerCompany:1,maxWorkAreasPerCompany:2,maxProSeats:1}},
 company:{id:'company',family:'company',version:'v1',displayName:'Company',limits:{maxCoveredCompanies:1,maxChemicalProductsPerCompany:null,maxWorkersPerCompany:null,maxWorkAreasPerCompany:null,maxProSeats:0},monthlyUsdCents:1000,annualUsdCents:10000},
 pro:{id:'pro',family:'pro',version:'v1',displayName:'Pro',limits:{maxCoveredCompanies:25,maxChemicalProductsPerCompany:null,maxWorkersPerCompany:null,maxWorkAreasPerCompany:null,maxProSeats:25},monthlyUsdCents:2500,annualUsdCents:25000,additionalSeatMonthlyUsdCents:500,additionalSeatAnnualUsdCents:5000}
});
export const GRACE_DAYS=14;
export const DAY_MS=86400000;
export function canonicalPlan(value:unknown):'demo'|'company'|'pro'|null {
 if(value==='demo'||value==='company'||value==='pro')return value;
 if(value==='customer')return 'company';
 if(value==='professional')return 'pro';
 return null;
}
function millis(value:unknown):number {
 if(typeof value==='number')return value;
 if(typeof value==='string')return Date.parse(value);
 if(value instanceof Date)return value.getTime();
 if(value&&typeof value==='object'&&'toMillis' in value&&typeof value.toMillis==='function')return (value.toMillis as ()=>number)();
 return NaN;
}
export function catalogPlan(state:{plan?:unknown;demoType?:unknown;tierId?:unknown;catalogVersion?:unknown}|undefined,catalog:Readonly<Record<string,CatalogPlan>>=DEVELOPMENT_CATALOG):CatalogPlan|null {
 const family=canonicalPlan(state?.plan);if(!family)return null;
 const id=family==='demo'?`demo_${state?.demoType==='pro'?'pro':'company'}`:String(state?.tierId??family);
 const definition=catalog[id];
 if(!definition||definition.family!==family||(family==='demo'&&definition.demoType!==(state?.demoType==='pro'?'pro':'company')))return null;
 if(state?.catalogVersion&&state.catalogVersion!==definition.version)return null;
 return definition;
}
export interface CommercialResolution {plan:PlanFamily|null;tierId:string|null;demoType:DemoType|null;status:CommercialStatus;capabilities:Capabilities;paidThrough:number|null;graceEndsAt:number|null;catalogVersion:string|null;cadence:Cadence|null;priceVersion:string|null;}
export function resolveCommercial(state:Record<string,unknown>|undefined,now=Date.now(),catalog:Readonly<Record<string,CatalogPlan>>=DEVELOPMENT_CATALOG):CommercialResolution {
 const configured=catalogPlan(state,catalog),plan=['inactive','export_only','unknown'].includes(String(state?.status))?null:configured,family=plan?.family??null,demoType=plan?.demoType??null;
 const paidThrough=family&&family!=='demo'?millis(state?.paidThrough??state?.validUntil):NaN;
 const configuredGrace=millis(state?.graceEndsAt??state?.graceUntil);
 const validGrace=!Number.isFinite(configuredGrace)||(Number.isFinite(paidThrough)&&configuredGrace>=paidThrough&&configuredGrace<=paidThrough+GRACE_DAYS*DAY_MS);
 const graceEndsAt=Number.isFinite(paidThrough)?Math.min(Number.isFinite(configuredGrace)?configuredGrace:paidThrough+GRACE_DAYS*DAY_MS,paidThrough+GRACE_DAYS*DAY_MS):NaN;
 const status:CommercialStatus=family==='demo'?'active':validGrace&&Number.isFinite(paidThrough)&&now<paidThrough?'active':validGrace&&Number.isFinite(graceEndsAt)&&now<graceEndsAt?'grace':'expired';
 const active=status==='active',read=status!=='expired',demo=family==='demo',pro=family==='pro'||demoType==='pro';
 const zero:Capabilities={maxCoveredCompanies:0,maxChemicalProductsPerCompany:0,maxWorkersPerCompany:0,maxWorkAreasPerCompany:0,maxProSeats:0,canPublish:false,canInviteCompanyMembers:false,canCreateCompanies:false,canExportBackup:false,canManageCompanySettings:false,canUseProTeam:false,canAuthor:false,canReadPublished:false};
 const capabilities=plan?{
  ...plan.limits,canPublish:active&&!demo,canInviteCompanyMembers:active&&!demo,
  canCreateCompanies:active,canExportBackup:!demo&&read,canManageCompanySettings:active&&!demo,
  canUseProTeam:active&&pro,canAuthor:active,canReadPublished:read
 }:zero;
 if(!active){capabilities.canCreateCompanies=false;capabilities.canAuthor=false;capabilities.canUseProTeam=false;}
 return {plan:family,tierId:plan?.id??null,demoType,status,capabilities,paidThrough:Number.isFinite(paidThrough)?paidThrough:null,graceEndsAt:Number.isFinite(graceEndsAt)?graceEndsAt:null,catalogVersion:plan?.version??null,cadence:state?.cadence==='monthly'||state?.cadence==='annual'?state.cadence:null,priceVersion:typeof state?.priceVersion==='string'?state.priceVersion:null};
}
export function mayCreateWithinLimit(limit:number|null,current:number):boolean{return limit===null||current<limit;}
export function enforcePublicationLimits(capabilities:Capabilities,counts:Record<string,number>):void {
 for(const [kind,key] of [['chemicalProducts','maxChemicalProductsPerCompany'],['workers','maxWorkersPerCompany'],['workAreas','maxWorkAreasPerCompany']] as const){
  const count=counts[kind]??0,limit=capabilities[key];
  if(!Number.isSafeInteger(count)||count<0||limit!==null&&count>limit)throw Error(`${kind} exceeds commercial publication limit`);
 }
}
export function mayAuthorCompany(resolution:CommercialResolution,companyId:string,selectedDemoCompanyId:string|null):boolean {
 return resolution.capabilities.canAuthor&&(resolution.plan!=='demo'||resolution.demoType==='pro'||selectedDemoCompanyId===companyId);
}
export function addCalendarMonths(date:Date,months:number):Date {
 if(!Number.isInteger(months)||months<1)throw Error('Invalid renewal interval');
 const year=date.getUTCFullYear(),month=date.getUTCMonth(),day=date.getUTCDate(),result=new Date(date.getTime());
 result.setUTCDate(1);result.setUTCFullYear(year,month+months,1);
 const last=new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth()+1,0)).getUTCDate();
 result.setUTCDate(Math.min(day,last));return result;
}
export function nextAnniversary(date:Date,cadence:Cadence):Date{return addCalendarMonths(date,cadence==='annual'?12:1);}
export function proratedCents(fullTermCents:number,termStart:number,termEnd:number,changeAt:number):number {
 if(!Number.isSafeInteger(fullTermCents)||fullTermCents<0||!Number.isFinite(termStart)||!Number.isFinite(termEnd)||!Number.isFinite(changeAt)||termEnd<=termStart)throw Error('Invalid proration term');
 return Math.round(fullTermCents*Math.max(0,Math.min(1,(termEnd-changeAt)/(termEnd-termStart))));
}
export type BillingEventType='subscription_started'|'subscription_renewed'|'subscription_upgrade'|'subscription_downgrade_scheduled'|'subscription_cancel_at_period_end'|'payment_failed'|'payment_recovered'|'seat_added'|'seat_removed'|'coverage_transferred';
export interface BillingEvent {id:string;type:BillingEventType;subscriptionId:string;version:number;effectiveAt:string;payload:Record<string,unknown>;source:string;}
export interface BillingAdjustment {eventId:string;kind:'upgrade'|'seat_add';creditCents:number;chargeCents:number;cadence:Cadence;}
export interface CommercialState {subscriptionId:string;plan:string;demoType?:DemoType;tierId?:string;catalogVersion:string;cadence?:Cadence;priceVersion?:string;termStartedAt?:string;basePriceCents?:number;seatPriceCents?:number;billingAdjustments?:BillingAdjustment[];paidThrough?:string;graceEndsAt?:string;cancelAtPeriodEnd?:boolean;seatIds:string[];coveredCompanyIds:string[];selectedDemoCompanyId?:string|null;pendingDowngrade?:{tierId:string;retainedCompanyId:string;effectiveAt:string};lastVersion:number;appliedEventIds:string[];audit:{id:string;type:BillingEventType;at:string;source:string}[];}
/** Pure provider-neutral transition. The trusted adapter must authenticate the event source. */
export function applyBillingEvent(state:CommercialState,event:BillingEvent,catalog:Readonly<Record<string,CatalogPlan>>=DEVELOPMENT_CATALOG):CommercialState {
 if(event.subscriptionId!==state.subscriptionId||!event.id||!event.source)throw Error('Invalid billing event identity');
 if(state.appliedEventIds.includes(event.id))return state;
 if(event.version!==state.lastVersion+1)throw Error('Out-of-order billing event');
 const when=new Date(event.effectiveAt);if(!Number.isFinite(when.getTime()))throw Error('Invalid event time');
 const next:CommercialState={...state,seatIds:[...state.seatIds],coveredCompanyIds:[...state.coveredCompanyIds],billingAdjustments:[...(state.billingAdjustments??[])],appliedEventIds:[...state.appliedEventIds,event.id],audit:[...state.audit,{id:event.id,type:event.type,at:event.effectiveAt,source:event.source}],lastVersion:event.version};
 const target=String(event.payload.tierId??'');
 if(['subscription_started','subscription_upgrade'].includes(event.type)) {
  const plan=catalog[target];if(!plan||plan.family==='demo')throw Error('Unknown paid tier');
  next.plan=plan.family;next.tierId=target;next.catalogVersion=plan.version;
  next.seatIds=plan.family==='pro'?Array.from(new Set([state.subscriptionId,...next.seatIds])):[];
  if(plan.family==='company'&&next.coveredCompanyIds.length>1){
   const retained=String(event.payload.retainedCompanyId??'');
   if(!next.coveredCompanyIds.includes(retained))throw Error('Select an existing Company to retain');
   next.coveredCompanyIds=[retained];
  }
  const cadence=event.payload.cadence;if(cadence!=='monthly'&&cadence!=='annual')throw Error('Invalid cadence');
  const preserveAnniversary=event.type==='subscription_upgrade'&&state.cadence===cadence&&Number.isFinite(Date.parse(state.paidThrough??''))&&Date.parse(state.paidThrough!)>when.getTime();
  const targetPrice=cadence==='monthly'?plan.monthlyUsdCents:plan.annualUsdCents;
  if(!Number.isSafeInteger(targetPrice))throw Error('Paid tier price missing');
  if(event.type==='subscription_upgrade'&&state.plan!=='demo'){
   const start=Date.parse(state.termStartedAt??event.effectiveAt),end=Date.parse(state.paidThrough??event.effectiveAt);
   const credit=Number.isFinite(start)&&Number.isFinite(end)&&end>start?proratedCents(state.basePriceCents??0,start,end,when.getTime()):0;
   const charge=preserveAnniversary?proratedCents(targetPrice!,start,end,when.getTime()):targetPrice!;
   next.billingAdjustments!.push({eventId:event.id,kind:'upgrade',creditCents:credit,chargeCents:charge,cadence});
  }
  next.cadence=cadence;next.priceVersion=String(event.payload.priceVersion??plan.version);
  next.basePriceCents=targetPrice;next.seatPriceCents=cadence==='monthly'?plan.additionalSeatMonthlyUsdCents:plan.additionalSeatAnnualUsdCents;
  next.termStartedAt=preserveAnniversary?state.termStartedAt??event.effectiveAt:event.effectiveAt;
  const paid=event.payload.paidThrough;next.paidThrough=typeof paid==='string'?paid:preserveAnniversary?state.paidThrough:nextAnniversary(when,cadence).toISOString();
  if(!Number.isFinite(Date.parse(next.paidThrough??''))||Date.parse(next.paidThrough!)<=when.getTime())throw Error('Invalid paid-through date');
   next.graceEndsAt=new Date(Date.parse(next.paidThrough!)+GRACE_DAYS*DAY_MS).toISOString();next.cancelAtPeriodEnd=false;
 } else if(event.type==='subscription_renewed'||event.type==='payment_recovered') {
  if(!next.cadence)throw Error('Missing billing cadence');
  if(event.type==='subscription_renewed'&&next.pendingDowngrade&&when.getTime()>=Date.parse(next.pendingDowngrade.effectiveAt)){
   const downgrade=catalog[next.pendingDowngrade.tierId];
   if(!downgrade||downgrade.family!=='company')throw Error('Invalid scheduled Company tier');
   next.plan='company';next.tierId=downgrade.id;next.catalogVersion=downgrade.version;
   next.seatIds=[];
   next.priceVersion=String(event.payload.priceVersion??downgrade.version);
   next.basePriceCents=next.cadence==='monthly'?downgrade.monthlyUsdCents:downgrade.annualUsdCents;
   next.seatPriceCents=undefined;
   next.coveredCompanyIds=[next.pendingDowngrade.retainedCompanyId];
   delete next.pendingDowngrade;
  }
  const base=new Date(Math.max(when.getTime(),Date.parse(next.paidThrough??event.effectiveAt)));
  next.termStartedAt=base.toISOString();
  next.paidThrough=nextAnniversary(base,next.cadence).toISOString();next.graceEndsAt=new Date(Date.parse(next.paidThrough)+GRACE_DAYS*DAY_MS).toISOString();next.cancelAtPeriodEnd=false;
 } else if(event.type==='subscription_cancel_at_period_end')next.cancelAtPeriodEnd=true;
 else if(event.type==='subscription_downgrade_scheduled'){
  if(catalog[target]?.family!=='company'||!next.coveredCompanyIds.includes(String(event.payload.retainedCompanyId))||!next.paidThrough)throw Error('Select an existing Company for downgrade');
  next.pendingDowngrade={tierId:target,retainedCompanyId:String(event.payload.retainedCompanyId),effectiveAt:next.paidThrough??''};
 } else if(event.type==='seat_added'){
  const seat=String(event.payload.uid??'');const plan=catalogPlan(next,catalog);
  if(!seat||!plan||next.seatIds.includes(seat)||!mayCreateWithinLimit(plan.limits.maxProSeats,next.seatIds.length))throw Error('Pro seat limit or duplicate seat');
  if(!next.cadence||!next.paidThrough||!next.termStartedAt||!Number.isSafeInteger(next.seatPriceCents))throw Error('Seat price term missing');
  next.billingAdjustments!.push({eventId:event.id,kind:'seat_add',creditCents:0,chargeCents:proratedCents(next.seatPriceCents!,Date.parse(next.termStartedAt),Date.parse(next.paidThrough),when.getTime()),cadence:next.cadence});
  next.seatIds.push(seat);
 } else if(event.type==='seat_removed'){
  const seat=String(event.payload.uid??'');if(next.seatIds[0]===seat)throw Error('Cannot remove base Pro seat');
  next.seatIds=next.seatIds.filter(id=>id!==seat);
 } else if(event.type==='coverage_transferred')next.coveredCompanyIds=next.coveredCompanyIds.filter(id=>id!==event.payload.companyId);
 return next;
}
export function cleanupEligible(coverage:{subscriptionId:string;graceEndsAt:string},currentCoverage:{subscriptionId:string}|null,now=Date.now()):boolean {
 return currentCoverage?.subscriptionId===coverage.subscriptionId&&now>=Date.parse(coverage.graceEndsAt);
}
