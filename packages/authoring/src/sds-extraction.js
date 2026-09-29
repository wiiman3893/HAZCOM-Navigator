const compact=value=>String(value??'').replace(/[\t\f\v ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const evidence=value=>compact(value).replace(/\s+/g,' ').slice(0,320);
const confidence=(source,label,section)=>source!=='embedded'?'medium':label&&section===1?'high':label?'medium':'low';
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
const pageSource=page=>['embedded','ocr','mixed'].includes(page?.textSource)?page.textSource:'unavailable';
function labelEvidence(pages,patterns,allowedPages){for(const page of pages){if(allowedPages&&!allowedPages.includes(page.pageNumber))continue;const hit=matchLabel(normalizePageText(page.normalizedText??page.text),patterns);if(hit)return {...hit,page:page.pageNumber,source:pageSource(page)};}return null;}
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
 const first=pages[0]??{};
 const product=labelEvidence(pages,[/(?:product\s+(?:identifier|name)|trade\s+name|material\s+name)\s*[:\-]\s*([^\n|;]{2,160})/i],section1?.pages);
 const manufacturer=labelEvidence(pages,[/(?:manufacturer|supplier|company)\s*(?:name)?\s*[:\-]\s*([^\n|;]{2,160})/i],section1?.pages);
 const dateHit=labelEvidence(pages,[/(?:revision|revised|preparation|prepared|issue|issued)\s*(?:date)?\s*[:\-]\s*([^\n;]{4,60})/i],section16?.pages)??labelEvidence(pages,[/(?:revision|revised|preparation|prepared|issue|issued)\s*(?:date)?\s*[:\-]\s*([^\n;]{4,60})/i],section1?.pages);
 const casEvidence=[];for(const page of pages){const text=normalizePageText(page.normalizedText??page.text),values=[...text.matchAll(/\b\d{2,7}-\d{2}-\d\b/g)].map(match=>match[0]).filter(validCas);if(values.length)casEvidence.push({page:page.pageNumber,source:pageSource(page),values,text});}
 const cas=[...new Set(casEvidence.flatMap(value=>value.values))].slice(0,50),casSources=new Set(casEvidence.filter(value=>value.values.some(c=>cas.includes(c))).map(value=>value.source));
 const casMethod=casSources.size>1?'mixed':casSources.values().next().value??'unavailable',casFirst=casEvidence[0],casSnippet=casFirst?evidence(casFirst.text.slice(Math.max(0,casFirst.text.indexOf(cas[0])-80),casFirst.text.indexOf(cas[0])+240)):'';
 const revision=dateHit?isoDate(dateHit.value):null;
 return [
  field('product_name',product?.value,{section:section1?1:null,page:product?.page??first.pageNumber,source:product?.source??pageSource(first),label:!!product,snippet:product?.snippet}),
  field('manufacturer',manufacturer?.value,{section:section1?1:null,page:manufacturer?.page??first.pageNumber,source:manufacturer?.source??pageSource(first),label:!!manufacturer,snippet:manufacturer?.snippet}),
  field('sds_date',revision,{section:section16?.pages.includes(dateHit?.page)?16:section1?1:null,page:dateHit?.page??first.pageNumber,source:dateHit?.source??pageSource(first),label:!!dateHit,snippet:dateHit?.snippet}),
  field('cas_numbers',cas.join(', ')||null,{section:sections.find(s=>s.number===3)?3:null,page:casFirst?.page??null,source:casMethod,label:cas.length>0,snippet:casSnippet}),
 ];
}

export function analyzeSdsCandidate(pages){
 const normalized=pages.map(page=>({...page,normalizedText:normalizePageText(page.normalizedText??page.text)}));
 const sections=parseSdsSections(normalized),fields=extractSdsFields(normalized,sections);
 return {version:SDS_EXTRACTION_VERSION,sections,fields,status:fields.some(f=>f.confidence==='unresolved')?'needs_review':'ready'};
}
