import {PDFDocument,PDFRawStream,PDFRef,decodePDFRawStream} from 'pdf-lib';

const need=(value,message)=>{if(!value)throw Error(message);};
const latin1=new TextDecoder('latin1');

export const MAX_SDS_BATCH_BYTES=250*1024*1024;
export const MAX_SDS_BATCH_PAGES=2000;

export async function sha256Hex(bytes){
 need(bytes instanceof Uint8Array,'PDF bytes are required');
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function decodeLiteral(value){
 let out='';
 for(let i=0;i<value.length;i++){
  const ch=value[i];
  if(ch!=='\\'){out+=ch;continue;}
  const next=value[++i];
  if(next===undefined)break;
  if(next==='n')out+='\n';
  else if(next==='r')out+='\r';
  else if(next==='t')out+='\t';
  else if(next==='b')out+='\b';
  else if(next==='f')out+='\f';
  else if(next==='\n'){}
  else if(next==='\r'){if(value[i+1]==='\n')i++;}
  else if(/[0-7]/.test(next)){
   let oct=next;
   for(let n=0;n<2&&/[0-7]/.test(value[i+1]??'');n++)oct+=value[++i];
   out+=String.fromCharCode(parseInt(oct,8));
  }else out+=next;
 }
 return out;
}

function decodeHex(value){
 const clean=value.replace(/\s+/g,'');
 if(!clean)return '';
 const hex=clean.length%2?clean+'0':clean;
 const bytes=new Uint8Array(hex.length/2);
 for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.slice(i*2,i*2+2),16);
 if(bytes.length>=2&&bytes[0]===0xfe&&bytes[1]===0xff){
  let out='';for(let i=2;i+1<bytes.length;i+=2)out+=String.fromCharCode((bytes[i]<<8)|bytes[i+1]);return out;
 }
 let zeroHigh=0,pairs=0;
 for(let i=0;i+1<bytes.length;i+=2){pairs++;if(bytes[i]===0)zeroHigh++;}
 if(pairs&&zeroHigh/pairs>0.55){
  let out='';for(let i=0;i+1<bytes.length;i+=2)out+=String.fromCharCode((bytes[i]<<8)|bytes[i+1]);return out;
 }
 return latin1.decode(bytes);
}

function contentStrings(content){
 const out=[];
 for(let i=0;i<content.length;i++){
  if(content[i]==='('){
   let depth=1,escaped=false,raw='';
   for(i=i+1;i<content.length;i++){
    const ch=content[i];
    if(escaped){raw+='\\'+ch;escaped=false;continue;}
    if(ch==='\\'){escaped=true;continue;}
    if(ch==='('){depth++;raw+=ch;continue;}
    if(ch===')'){depth--;if(depth===0)break;raw+=ch;continue;}
    raw+=ch;
   }
   const value=decodeLiteral(raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').trim();
   if(value)out.push(value);
  }else if(content[i]==='<'&&content[i+1]!=='<'){
   const end=content.indexOf('>',i+1);
   if(end>i){
    const raw=content.slice(i+1,end);
    if(/^[0-9A-Fa-f\s]+$/.test(raw)){
     const value=decodeHex(raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').trim();
     if(value)out.push(value);
    }
    i=end;
   }
  }
 }
 return out;
}

function decodedPageText(pdf,page){
 const pieces=[];
 try{
  const {Contents}=page.node.normalizedEntries();
  for(const entry of Contents.asArray()){
   const stream=entry instanceof PDFRef?pdf.context.lookup(entry):entry;
   let bytes=null;
   if(stream instanceof PDFRawStream)bytes=decodePDFRawStream(stream).decode();
   else if(stream&&typeof stream.getUnencodedContents==='function')bytes=stream.getUnencodedContents();
   if(bytes)pieces.push(...contentStrings(latin1.decode(bytes)));
  }
 }catch{
  // A page can still be reviewed manually when its content stream is unsupported.
 }
 return pieces.join('\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}

function pageSignals(text){
 const upper=text.toUpperCase();
 const pageMatch=upper.match(/\bPAGE\s*([0-9]{1,4})\s*(?:OF|\/)\s*([0-9]{1,4})\b/);
 return {
  safetyDataSheet:/\bSAFETY\s+DATA\s+SHEET\b/.test(upper),
  section1:/\bSECTION\s*0?1\b(?:\s*[:.\-–—]?\s*(?:IDENTIFICATION|PRODUCT\s+AND\s+COMPANY\s+IDENTIFICATION))?/.test(upper),
  section16:/\bSECTION\s*16\b/.test(upper),
  pageNumber:pageMatch?Number(pageMatch[1]):null,
  pageTotal:pageMatch?Number(pageMatch[2]):null
 };
}

function detectedTitle(text){
 const patterns=[
  /(?:PRODUCT\s+(?:IDENTIFIER|NAME)|PRODUCT|TRADE\s+NAME|MATERIAL\s+NAME)\s*[:\-–—]?\s*([^\n\r]{2,120})/i,
  /(?:IDENTIFICATION\s+OF\s+THE\s+(?:SUBSTANCE|MIXTURE))\s*[:\-–—]?\s*([^\n\r]{2,120})/i
 ];
 for(const pattern of patterns){
  const match=text.match(pattern);
  if(match){
   const title=match[1].replace(/\s+/g,' ').trim().replace(/\b(?:SECTION\s*2|HAZARDS?\s+IDENTIFICATION).*$/i,'').trim();
   if(title&&title.length<=120)return title;
  }
 }
 const lines=text.split(/\n+/).map(v=>v.trim()).filter(Boolean);
 const sds=lines.findIndex(v=>/safety\s+data\s+sheet/i.test(v));
 for(const line of lines.slice(Math.max(0,sds+1),Math.max(0,sds+5))){
  if(!/^section\s*0?1\b/i.test(line)&&!/^(identification|page\s+\d+)/i.test(line)&&line.length>=3&&line.length<=100)return line;
 }
 return null;
}

export function detectSdsCandidates(pages){
 need(Array.isArray(pages)&&pages.length>0,'At least one PDF page is required');
 const starts=[];
 const first=pages[0],firstReasons=[];
 if(first.signals.safetyDataSheet)firstReasons.push('Safety Data Sheet heading');
 if(first.signals.section1)firstReasons.push('Section 1');
 if(first.signals.pageNumber===1)firstReasons.push('page numbering starts at 1');
 starts.push({page:1,score:firstReasons.length?4:0,reasons:firstReasons.length?firstReasons:['first source page']});
 for(let i=1;i<pages.length;i++){
  const current=pages[i],previous=pages[i-1],reasons=[];let score=0;
  if(current.signals.section1){score+=3;reasons.push('Section 1 detected');}
  if(current.signals.safetyDataSheet){score+=2;reasons.push('Safety Data Sheet heading detected');}
  if(current.signals.pageNumber===1){score+=2;reasons.push('page numbering restarted at 1');}
  if(previous.signals.section16){score+=1;reasons.push('previous page contains Section 16');}
  if(score>=2)starts.push({page:i+1,score,reasons});
 }
 return starts.map((start,index)=>{
  const endPage=(starts[index+1]?.page??pages.length+1)-1;
  const page=pages[start.page-1];
  const confidence=start.score>=4?'likely':'uncertain';
  const reason=confidence==='likely'?start.reasons.join('; '):start.score?start.reasons.join('; ')+'; review this proposed boundary':'No reliable boundary signal; manual review required';
  return {id:null,ordinal:index+1,startPage:start.page,endPage,confidence,reason,detectedTitle:detectedTitle(page.text),sourceHasOcrRequired:pages.slice(start.page-1,endPage).some(p=>p.textStatus==='ocr_required')};
 });
}

export async function analyzeSdsBatchPdf(bytes){
 need(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=MAX_SDS_BATCH_BYTES,'Choose a PDF no larger than 250 MiB');
 need(latin1.decode(bytes.slice(0,5))==='%PDF-','Choose a valid PDF');
 const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
 const pageCount=pdf.getPageCount();
 need(pageCount>0&&pageCount<=MAX_SDS_BATCH_PAGES,`PDF must contain 1-${MAX_SDS_BATCH_PAGES} pages`);
 const pages=[];
 for(let i=0;i<pageCount;i++){
  const text=decodedPageText(pdf,pdf.getPage(i));
  pages.push({pageNumber:i+1,text,textStatus:text.trim()?'embedded':'ocr_required',signals:pageSignals(text)});
 }
 const candidates=detectSdsCandidates(pages);
 return {pageCount,pages,candidates};
}

export function assertDraftCoverage(drafts,pageCount){
 need(Number.isInteger(pageCount)&&pageCount>0,'Invalid source page count');
 need(Array.isArray(drafts)&&drafts.length>0,'At least one SDS draft is required');
 const sorted=[...drafts].sort((a,b)=>a.startPage-b.startPage||a.endPage-b.endPage);
 let expected=1;
 for(const draft of sorted){
  need(Number.isInteger(draft.startPage)&&Number.isInteger(draft.endPage)&&draft.startPage===expected&&draft.endPage>=draft.startPage&&draft.endPage<=pageCount,'SDS draft page ranges must cover the source exactly once');
  expected=draft.endPage+1;
 }
 need(expected===pageCount+1,'SDS draft page ranges must cover every source page');
 return true;
}

export async function materializeSdsCandidatePdf(sourceBytes,startPage,endPage){
 need(sourceBytes instanceof Uint8Array,'Source PDF bytes are required');
 const source=await PDFDocument.load(sourceBytes,{updateMetadata:false});
 const pageCount=source.getPageCount();
 need(Number.isInteger(startPage)&&Number.isInteger(endPage)&&startPage>=1&&endPage>=startPage&&endPage<=pageCount,'Invalid SDS draft page range');
 const child=await PDFDocument.create();
 const indexes=Array.from({length:endPage-startPage+1},(_,i)=>startPage-1+i);
 const copied=await child.copyPages(source,indexes);
 for(const page of copied)child.addPage(page);
 return new Uint8Array(await child.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false}));
}
