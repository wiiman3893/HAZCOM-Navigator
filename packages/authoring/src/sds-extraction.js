const compact=value=>String(value??'').replace(/[\t\f\v ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const evidence=value=>compact(value).replace(/\s+/g,' ').slice(0,320);
const confidence=(source,label,section)=>source==='ocr'?'medium':label&&section===1?'high':label?'medium':'low';
const field=(name,value,{section=null,page=null,source='unavailable',label=false,snippet='' }={})=>({fieldName:name,proposedValue:value||null,sourceSection:section,sourcePage:page,evidence:evidence(snippet),method:source,confidence:value?confidence(source,label,section):'unresolved'});

export const SDS_EXTRACTION_VERSION=1;
export const SDS_OCR_VERSION=1;

/** Conservative normalization for parsing. Raw extracted/OCR text is persisted separately. */
export function normalizePageText(value){
 let text=String(value??'').replace(/\r\n?/g,'\n').normalize('NFKC');
 // Join OCR-separated letters only in standard section headings; never rewrite chemical values.
 text=text.replace(/\bS\s+E\s+C\s+T\s+I\s+O\s+N\b/gi,'SECTION');
 text=text.split('\n').map(line=>line.replace(/[\t ]+/g,' ').trim()).filter((line,index,rows)=>line||rows[index-1]).join('\n');
 return text.slice(0,256*1024);
}

const heading=/^(?:safety\s+data\s+sheet\s+)?(?:section\s*)?(0?[1-9]|1[0-6])(?:\s*[.):-]|\s+)(.*)$/i;
export function parseSdsSections(pages){
 const found=[];let current=null;
 for(const page of pages){
  const text=normalizePageText(page.normalizedText??page.text),lines=text.split('\n');
  for(let i=0;i<lines.length;i++){
   const line=lines[i],match=line.match(heading);
   if(match){const number=Number(match[1]);current={number,pages:[page.pageNumber],heading:evidence(line),text:match[2]?[match[2]]:[],confidence:/section/i.test(line)?'high':'medium'};found.push(current);continue;}
   if(current){if(!current.pages.includes(page.pageNumber))current.pages.push(page.pageNumber);current.text.push(line);}
  }
 }
 // Repeated headings are evidence, not a reason to merge unrelated spans.
 return found.map(s=>({...s,text:compact(s.text.join('\n')).slice(0,128*1024)}));
}

function matchLabel(text,patterns){for(const pattern of patterns){const match=text.match(pattern);if(match?.[1])return {value:evidence(match[1]),snippet:evidence(match[0]),label:true};}return null;}
function validCas(value){const digits=value.replaceAll('-','');if(digits.length<5)return false;const check=Number(digits.at(-1));let sum=0,multiplier=1;for(let i=digits.length-2;i>=0;i--)sum+=Number(digits[i])*multiplier++;return sum%10===check;}
function isoDate(value){
 const input=evidence(value);let match=input.match(/\b(20\d{2}|19\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
 if(match){const iso=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;if(new Date(iso+'T00:00:00Z').toISOString().slice(0,10)===iso)return iso;}
 match=input.match(/\b(0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])[-/.](20\d{2}|19\d{2})\b/);
 if(match){const iso=`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;if(new Date(iso+'T00:00:00Z').toISOString().slice(0,10)===iso)return iso;}
 return null;
}

export function extractSdsFields(pages,sections=parseSdsSections(pages)){
 const section1=sections.find(s=>s.number===1),section16=sections.findLast?.(s=>s.number===16)??[...sections].reverse().find(s=>s.number===16);
 const first=pages[0]??{},one=section1?.text||normalizePageText(first.normalizedText??first.text),sixteen=section16?.text||'';
 const source=pages.some(p=>p.textSource==='ocr')?'ocr':pages.some(p=>p.textSource==='mixed')?'mixed':pages.some(p=>p.textSource==='embedded')?'embedded':'unavailable';
 const product=matchLabel(one,[/(?:product\s+(?:identifier|name)|trade\s+name|material\s+name)\s*[:\-]\s*([^\n|;]{2,160})/i]);
 const manufacturer=matchLabel(one,[/(?:manufacturer|supplier|company)\s*(?:name)?\s*[:\-]\s*([^\n|;]{2,160})/i]);
 const dateHit=matchLabel(sixteen+'\n'+one,[/(?:revision|revised|preparation|prepared|issue|issued)\s*(?:date)?\s*[:\-]\s*([^\n;]{4,60})/i]);
 const combined=pages.map(p=>normalizePageText(p.normalizedText??p.text)).join('\n');
 const casMatches=[...combined.matchAll(/\b\d{2,7}-\d{2}-\d\b/g)].map(m=>m[0]);
 const cas=[...new Set(casMatches.filter(validCas))].slice(0,50);
 const casSnippet=cas.length?evidence(combined.slice(Math.max(0,combined.indexOf(cas[0])-80),combined.indexOf(cas[0])+240)):'';
 const revision=dateHit?isoDate(dateHit.value):null;
 return [
  field('product_name',product?.value,{section:section1?1:null,page:section1?.pages[0]??first.pageNumber,source,label:!!product,snippet:product?.snippet}),
  field('manufacturer',manufacturer?.value,{section:section1?1:null,page:section1?.pages[0]??first.pageNumber,source,label:!!manufacturer,snippet:manufacturer?.snippet}),
  field('sds_date',revision,{section:section16?16:section1?1:null,page:section16?.pages[0]??section1?.pages[0]??first.pageNumber,source,label:!!dateHit,snippet:dateHit?.snippet}),
  field('cas_numbers',cas.join(', ')||null,{section:sections.find(s=>s.number===3)?3:null,page:pages.find(p=>cas.some(n=>normalizePageText(p.normalizedText??p.text).includes(n)))?.pageNumber??null,source,label:cas.length>0,snippet:casSnippet}),
 ];
}

export function analyzeSdsCandidate(pages){
 const normalized=pages.map(page=>({...page,normalizedText:normalizePageText(page.normalizedText??page.text)}));
 const sections=parseSdsSections(normalized),fields=extractSdsFields(normalized,sections);
 return {version:SDS_EXTRACTION_VERSION,sections,fields,status:fields.some(f=>f.confidence==='unresolved')?'needs_review':'ready'};
}
