// Read-only validator for the complementary in-app timeline package.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import contract from '../../apps/windows/src/diagnostics/contract.json' with {type:'json'};
const fail=()=>{throw Error('Invalid diagnostic session package');};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function validateSessionPackage(bytes){
 if(bytes.length>4*1024*1024+16384||bytes.length<22)fail();
 const end=bytes.length-22;if(bytes.readUInt32LE(end)!==0x06054b50||bytes.readUInt16LE(end+10)!==3||bytes.readUInt16LE(end+20)!==0)fail();
 const files={},entries=[];let offset=0;
 for(let i=0;i<3;i++){
  if(offset+30>bytes.length||bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+6)!==0||bytes.readUInt16LE(offset+8)!==0)fail();
  const size=bytes.readUInt32LE(offset+18),nameSize=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+nameSize+extra;
  const name=bytes.subarray(offset+30,offset+30+nameSize).toString();
  if(!['manifest.json','app-events.jsonl','summary.json'].includes(name)||files[name]||extra||size!==bytes.readUInt32LE(offset+22)||start+size>end)fail();
  const data=bytes.subarray(start,start+size),crc=crc32(data);if(crc!==bytes.readUInt32LE(offset+14))fail();files[name]=data;entries.push({name,offset,size,crc});offset=start+size;
 }
 if(offset!==bytes.readUInt32LE(end+16))fail();
 const centralStart=offset;
 for(const entry of entries){
  if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50||bytes.readUInt16LE(offset+8)!==0||bytes.readUInt16LE(offset+10)!==0||bytes.readUInt32LE(offset+16)!==entry.crc||bytes.readUInt32LE(offset+20)!==entry.size||bytes.readUInt32LE(offset+24)!==entry.size||bytes.readUInt32LE(offset+42)!==entry.offset)fail();
  const size=bytes.readUInt16LE(offset+28);if(bytes.readUInt16LE(offset+30)||bytes.readUInt16LE(offset+32)||bytes.subarray(offset+46,offset+46+size).toString()!==entry.name)fail();offset+=46+size;
 }
 if(offset!==end||end-centralStart!==bytes.readUInt32LE(end+12))fail();
 const manifest=JSON.parse(files['manifest.json']),summary=JSON.parse(files['summary.json']);
 if(manifest.packageType!=='hazcom-diagnostic-session'||manifest.schemaVersion!==1||!/^diag_[a-f0-9]{32}$/.test(manifest.sessionId)||!['stopped','interrupted'].includes(manifest.state)||manifest.screenshots!==false||manifest.screenshotCount!==0)fail();
 const events=files['app-events.jsonl'].toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 if(events.length!==manifest.eventCount||summary.eventCount!==events.length||summary.sessionId!==manifest.sessionId||summary.eventsSha256!==hash(files['app-events.jsonl'])||summary.eventsBytes!==files['app-events.jsonl'].length)fail();
 for(const [index,e] of events.entries()){
  if(Object.keys(e).some(k=>!['schemaVersion','sessionId','sequence','timestampMs','event','recentFrom'].includes(k)))fail();
  if(e.sessionId!==manifest.sessionId||e.schemaVersion!==1||e.sequence!==index+1||!Number.isSafeInteger(e.timestampMs)||!contract.operations.includes(e.event.operation)||!contract.outcomes.includes(e.event.outcome))fail();
  const permitted=['operation','outcome','screen','company','workspace','entity','durationMs','count','bytes','readOnly','role','phase','reason','fields'];
  if(Object.keys(e.event).some(k=>!permitted.includes(k)))fail();
  for(const [key,group]of [['screen','screens'],['phase','phases'],['reason','reasons']])if(e.event[key]!=null&&!contract[group].includes(e.event[key]))fail();
  for(const key of ['company','workspace','entity'])if(e.event[key]!=null&&!/^[a-f0-9]{24}$/.test(e.event[key]))fail();
  if(e.event.fields?.some(f=>!contract.fields.includes(f)))fail();
  if(e.event.role!=null&&!['member','manager','administrator'].includes(e.event.role))fail();
  for(const key of ['durationMs','count','bytes'])if(e.event[key]!=null&&(!Number.isSafeInteger(e.event[key])||e.event[key]<0||e.event[key]>1_000_000_000))fail();
  if(e.event.readOnly!=null&&typeof e.event.readOnly!=='boolean')fail();
 }
 return {schemaVersion:1,sessionId:manifest.sessionId,state:manifest.state,eventCount:events.length,droppedEvents:manifest.droppedEvents,sha256:hash(bytes)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const bytes=await readFile(process.argv[2]);console.log(JSON.stringify(validateSessionPackage(bytes),null,2));}catch{console.error('Diagnostic session package could not be validated.');process.exitCode=1;}
}
