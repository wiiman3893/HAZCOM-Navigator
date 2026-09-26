const latin1=new TextDecoder('latin1');
const useful=text=>String(text??'').replace(/\s+/g,' ').trim();
const refList=value=>Array.from(String(value??'').matchAll(/(\d+)\s+\d+\s+R/g),m=>Number(m[1]));
function literal(value){return value.replace(/\\([nrtbf()\\])/g,(_m,c)=>({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','(':'(',')':')','\\':'\\'}[c]??c)).replace(/\\([0-7]{1,3})/g,(_m,o)=>String.fromCharCode(parseInt(o,8)));}
function textOperators(stream){
 const blocks=Array.from(stream.matchAll(/BT([\s\S]*?)ET/g),m=>m[1]);const out=[];
 for(const block of blocks){
  for(const m of block.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g))out.push(literal(m[1]));
  for(const m of block.matchAll(/\[((?:.|\n|\r)*?)\]\s*TJ/g))for(const s of m[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g))out.push(literal(s[1]));
  for(const m of block.matchAll(/<([0-9A-Fa-f]{2,})>\s*Tj/g)){const pairs=m[1].match(/../g)??[];const bytes=Uint8Array.from(pairs.map(x=>parseInt(x,16)));out.push(latin1.decode(bytes));}
 }
 return useful(out.join(' '));
}
async function streamText(body){
 const match=body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);if(!match)return '';
 let bytes=Uint8Array.from(match[1],c=>c.charCodeAt(0)&255);
 if(/\/FlateDecode/.test(body)){try{const ds=new DecompressionStream('deflate');bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());}catch{return '';}}
 return textOperators(latin1.decode(bytes));
}
function titleFrom(text){
 const compact=useful(text);
 for(const re of [/Product\s+(?:identifier|name)\s*[:\-]?\s*([^|;]{2,120})/i,/SECTION\s*1[^A-Za-z0-9]+IDENTIFICATION[^A-Za-z0-9]+([^|;]{2,120})/i]){
  const m=compact.match(re);if(m)return useful(m[1]).slice(0,120);
 }
 const lines=String(text).split(/\r?\n/).map(useful).filter(Boolean);
 return (lines.find(x=>!/^(safety data sheet|section\s*1|identification)$/i.test(x))??'').slice(0,120)||null;
}
export function detectSdsBoundaries(pages){
 const starts=[{page:1,score:99,reasons:['Source start']}];
 for(let i=1;i<pages.length;i++){
  const p=pages[i],t=p.text.toLowerCase(),prev=pages.slice(Math.max(0,i-3),i).map(x=>x.text.toLowerCase()).join('\n');
  const section1=/section\s*0?1\b/.test(t),sds=/safety\s+data\s+sheet/.test(t),pageOne=/page\s*1\s*(?:of|\/)/i.test(p.text),after16=/section\s*1?6\b/.test(prev);
  let score=0;const reasons=[];if(section1){score+=2;reasons.push('SECTION 1 detected');}if(sds){score+=2;reasons.push('Safety Data Sheet heading');}if(pageOne){score+=1;reasons.push('page numbering restarted at 1');}if(section1&&after16){score+=2;reasons.push('SECTION 16 precedes a new SECTION 1');}
  if(score>=2)starts.push({page:i+1,score,reasons});
 }
 const unique=[];for(const s of starts){const prior=unique.at(-1);if(prior&&prior.page===s.page){if(s.score>prior.score)unique[unique.length-1]=s;}else unique.push(s);}
 return unique.map((s,i)=>{const start=s.page,end=(unique[i+1]?.page??pages.length+1)-1,page=pages[start-1];return {id:crypto.randomUUID(),ordinal:i+1,startPage:start,endPage:end,confidence:s.score>=4||start===1?'likely':'uncertain',reason:s.reasons.join('; '),detectedTitle:titleFrom(page?.text??'')};});
}
export function normalizeDrafts(pageCount,drafts){
 const sorted=[...drafts].sort((a,b)=>a.startPage-b.startPage);let expected=1;
 for(const d of sorted){if(d.startPage!==expected||d.endPage<d.startPage||d.endPage>pageCount)throw Error('SDS draft ranges must cover every source page exactly once');expected=d.endPage+1;}
 if(expected!==pageCount+1)throw Error('SDS draft ranges must cover every source page exactly once');
 return sorted.map((d,i)=>({...d,ordinal:i+1}));
}
export function splitDrafts(pageCount,drafts,draftId,splitPage){
 const row=drafts.find(d=>d.id===draftId);if(!row)throw Error('Import draft not found');if(!Number.isInteger(splitPage)||splitPage<=row.startPage||splitPage>row.endPage)throw Error('Split page must be inside the selected range');
 return normalizeDrafts(pageCount,drafts.flatMap(d=>d.id!==draftId?[d]:[{...d,endPage:splitPage-1,confidence:'manual',reason:'Manual split'},{...d,id:crypto.randomUUID(),startPage:splitPage,confidence:'manual',reason:'Manual split'}]));
}
export function mergeDrafts(pageCount,drafts,draftId,direction){
 const rows=normalizeDrafts(pageCount,drafts),index=rows.findIndex(d=>d.id===draftId);if(index<0)throw Error('Import draft not found');const other=direction==='previous'?index-1:index+1;if(other<0||other>=rows.length)throw Error('No adjacent draft to merge');
 const low=Math.min(index,other),high=Math.max(index,other),merged={...rows[low],startPage:rows[low].startPage,endPage:rows[high].endPage,confidence:'manual',reason:'Manual merge',detectedTitle:rows[low].detectedTitle||rows[high].detectedTitle};
 return normalizeDrafts(pageCount,[...rows.slice(0,low),merged,...rows.slice(high+1)]);
}
export async function analyzeSdsPdf(bytes){
 if(!(bytes instanceof Uint8Array)||latin1.decode(bytes.slice(0,5))!=='%PDF-')throw Error('Choose a valid PDF');
 const raw=latin1.decode(bytes),objects=new Map();
 for(const m of raw.matchAll(/(\d+)\s+\d+\s+obj([\s\S]*?)endobj/g))objects.set(Number(m[1]),m[2]);
 const catalog=[...objects].find(([,b])=>/\/Type\s*\/Catalog\b/.test(b));const rootRef=catalog?.[1].match(/\/Pages\s+(\d+)\s+\d+\s+R/)?.[1];
 const order=[];const seen=new Set();
 const walk=id=>{if(seen.has(id))return;seen.add(id);const body=objects.get(id)??'';if(/\/Type\s*\/Page\b/.test(body)&&!/\/Type\s*\/Pages\b/.test(body)){order.push(id);return;}const kids=body.match(/\/Kids\s*\[([\s\S]*?)\]/)?.[1];for(const child of refList(kids))walk(child);};
 if(rootRef)walk(Number(rootRef));if(!order.length)for(const [id,b] of objects)if(/\/Type\s*\/Page\b/.test(b)&&!/\/Type\s*\/Pages\b/.test(b))order.push(id);
 if(!order.length)throw Error('PDF contains no readable page objects');
 const pages=[];
 for(let i=0;i<order.length;i++){const body=objects.get(order[i])??'';let refs=[];const array=body.match(/\/Contents\s*\[([\s\S]*?)\]/)?.[1];if(array)refs=refList(array);else{const one=body.match(/\/Contents\s+(\d+)\s+\d+\s+R/);if(one)refs=[Number(one[1])];}let text='';for(const ref of refs)text+=' '+await streamText(objects.get(ref)??'');text=useful(text);const hasText=(text.match(/[A-Za-z0-9]/g)?.length??0)>=12;pages.push({pageNumber:i+1,text,hasText,ocrRequired:!hasText,textSnippet:text.slice(0,500),signals:{section1:/section\s*0?1\b/i.test(text),section16:/section\s*1?6\b/i.test(text),sdsTitle:/safety\s+data\s+sheet/i.test(text),pageOne:/page\s*1\s*(?:of|\/)/i.test(text)}});}
 let drafts=detectSdsBoundaries(pages);if(!drafts.length)drafts=[{id:crypto.randomUUID(),ordinal:1,startPage:1,endPage:pages.length,confidence:'uncertain',reason:'No automatic boundary detected',detectedTitle:null}];drafts=normalizeDrafts(pages.length,drafts);
 return {pageCount:pages.length,pages,drafts,ocrRequired:pages.filter(p=>p.ocrRequired).length};
}
