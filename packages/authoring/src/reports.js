const text=value=>String(value??'').trim();
const compare=(a,b)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true});

export const REPORT_COLUMNS={
 chemicalInventory:[
  ['workArea','Work Area'],['workAreaLocation','Work Area Location'],['productName','Product Name'],['manufacturer','Manufacturer'],['casNumbers','CAS Numbers'],['quantity','Quantity'],['storageLocation','Storage Location'],['sdsDate','SDS Date'],['sdsPresent','SDS Present'],['sdsVerificationStatus','SDS Verification Status']
 ],
 complianceStatus:[
  ['category','Category'],['item','Item'],['context','Context'],['sdsPresent','SDS Present'],['latest','Most Recent Event'],['due','Next Due'],['status','Tracked Status']
 ],
 trainingStatus:[
  ['worker','Worker'],['workArea','Work Area'],['assignedDate','Assignment Date'],['endedDate','Assignment Ended Date'],['trainingRequiredSince','Training Required Since'],['latestTraining','Most Recent Training'],['status','Training Status']
 ]
};

export function chemicalInventoryReport(snapshot,{workAreaId='',query=''}={}){
 const products=new Map((snapshot.chemical_product??[]).filter(row=>!row.deleted_at).map(row=>[row.id,row]));
 const placements=(snapshot.work_area_product??[]).filter(row=>!row.deleted_at);
 const needle=text(query).toLocaleLowerCase();
 const rows=[];
 for(const area of (snapshot.work_area??[]).filter(row=>!row.deleted_at&&(!workAreaId||row.id===workAreaId))){
  const active=placements.filter(row=>row.work_area_id===area.id&&products.has(row.chemical_product_id));
  if(!active.length)rows.push({workAreaId:area.id,workArea:area.name,workAreaLocation:area.location,productName:'',manufacturer:'',casNumbers:'',quantity:'',storageLocation:'',sdsDate:'',sdsPresent:'No',sdsVerificationStatus:'',empty:true});
  for(const placement of active){const product=products.get(placement.chemical_product_id);rows.push({workAreaId:area.id,workArea:area.name,workAreaLocation:area.location,productName:product.product_name,manufacturer:product.manufacturer,casNumbers:product.cas_numbers??'',quantity:placement.quantity,storageLocation:placement.storage_location,sdsDate:product.sds_date,sdsPresent:product.hasSds?'Yes':'No',sdsVerificationStatus:product.status??'',empty:false});}
 }
 return rows.filter(row=>!needle||[row.workArea,row.workAreaLocation,row.productName,row.manufacturer,row.casNumbers,row.quantity,row.storageLocation].some(value=>text(value).toLocaleLowerCase().includes(needle))).sort((a,b)=>compare(a.workArea,b.workArea)||compare(a.workAreaLocation,b.workAreaLocation)||compare(a.productName,b.productName)||compare(a.manufacturer,b.manufacturer)||compare(a.storageLocation,b.storageLocation));
}

export function complianceStatusReport(snapshot){
 const products=(snapshot.chemical_product??[]).filter(row=>!row.deleted_at).map(row=>({category:'Chemical Product',item:row.product_name,context:row.manufacturer??'',sdsPresent:row.hasSds?'Yes':'No',latest:row.latest??'',due:row.due??'',status:row.hasSds?(row.status??'required'):'missing SDS'}));
 const areas=(snapshot.work_area??[]).filter(row=>!row.deleted_at).map(row=>({category:'Work Area',item:row.name,context:row.location??'',sdsPresent:'',latest:row.latest??'',due:row.due??'',status:row.status??'required'}));
 return [...products,...areas].sort((a,b)=>compare(a.category,b.category)||compare(a.item,b.item)||compare(a.context,b.context));
}

export function trainingStatusReport(snapshot,{includeHistorical=false}={}){
 const workers=new Map((snapshot.worker??[]).filter(row=>!row.deleted_at).map(row=>[row.id,row]));
 const areas=new Map((snapshot.work_area??[]).filter(row=>!row.deleted_at).map(row=>[row.id,row]));
 return (snapshot.work_area_assignment??[]).filter(row=>!row.deleted_at&&(includeHistorical||row.active)&&workers.has(row.worker_id)&&areas.has(row.work_area_id)).map(row=>({worker:workers.get(row.worker_id).name,workArea:areas.get(row.work_area_id).name,assignedDate:row.assigned_date,endedDate:row.ended_date??'',trainingRequiredSince:row.training_required_since??'',latestTraining:row.latest??'',status:row.status??'required'})).sort((a,b)=>compare(a.worker,b.worker)||compare(a.workArea,b.workArea)||compare(a.assignedDate,b.assignedDate));
}

const escapeCsv=value=>{const normalized=value==null?'':typeof value==='boolean'?(value?'Yes':'No'):String(value);return /[",\r\n]/.test(normalized)?`"${normalized.replaceAll('"','""')}"`:normalized;};
export function reportCsv(report,rows){
 const columns=REPORT_COLUMNS[report];if(!columns)throw Error('Unknown report export');
 return [columns.map(([,header])=>escapeCsv(header)).join(','),...rows.map(row=>columns.map(([key])=>escapeCsv(row[key])).join(','))].join('\r\n')+'\r\n';
}
