import test from 'node:test';
import assert from 'node:assert/strict';
import {chemicalInventoryReport,complianceStatusReport,trainingStatusReport,reportCsv} from '../src/index.js';

const snapshot=()=>({
 work_area:[
  {id:'area-b',name:'Warehouse',location:'North',deleted_at:null},
  {id:'area-a',name:'Mix Room',location:'Building A',deleted_at:null},
  {id:'area-empty',name:'Empty Area',location:'Building B',deleted_at:null},
  {id:'area-trash',name:'Trashed Area',location:'Hidden',deleted_at:'2026-01-01'}
 ],
 chemical_product:[
  {id:'product-a',product_name:'Cleaner, Heavy Duty',manufacturer:'Example "Safety"',cas_numbers:'67-64-1',sds_date:'2026-01-01',hasSds:true,status:'current',deleted_at:null},
  {id:'product-b',product_name:'No SDS Product',manufacturer:'Maker',cas_numbers:null,sds_date:'2025-01-01',hasSds:false,status:'overdue',deleted_at:null},
  {id:'product-trash',product_name:'Trashed Product',manufacturer:'Hidden',sds_date:'2025-01-01',hasSds:true,status:'current',deleted_at:'2026-01-01'}
 ],
 work_area_product:[
  {id:'place-2',work_area_id:'area-b',chemical_product_id:'product-a',quantity:'2 drums',storage_location:'Rack B',deleted_at:null},
  {id:'place-1',work_area_id:'area-a',chemical_product_id:'product-a',quantity:'1\ncontainer',storage_location:'Cabinet A',deleted_at:null},
  {id:'place-missing',work_area_id:'area-a',chemical_product_id:'product-b',quantity:'3 bottles',storage_location:'Shelf',deleted_at:null},
  {id:'place-removed',work_area_id:'area-a',chemical_product_id:'product-a',quantity:'removed',storage_location:'Old shelf',deleted_at:'2026-01-01'},
  {id:'place-trash-product',work_area_id:'area-a',chemical_product_id:'product-trash',quantity:'hidden',storage_location:'Hidden',deleted_at:null},
  {id:'place-trash-area',work_area_id:'area-trash',chemical_product_id:'product-a',quantity:'hidden',storage_location:'Hidden',deleted_at:null}
 ],
 worker:[{id:'worker-b',name:'Zulu Worker',deleted_at:null},{id:'worker-a',name:'Alpha Worker',deleted_at:null},{id:'worker-trash',name:'Hidden Worker',deleted_at:'2026-01-01'}],
 work_area_assignment:[
  {id:'assignment-current',worker_id:'worker-a',work_area_id:'area-a',assigned_date:'2026-01-01',ended_date:null,training_required_since:'2026-01-01',latest:'2026-02-01',status:'current',active:true,deleted_at:null},
  {id:'assignment-required',worker_id:'worker-b',work_area_id:'area-b',assigned_date:'2026-03-01',ended_date:null,training_required_since:'2026-03-01',latest:null,status:'required',active:true,deleted_at:null},
  {id:'assignment-ended',worker_id:'worker-a',work_area_id:'area-b',assigned_date:'2025-01-01',ended_date:'2025-12-01',training_required_since:'2025-01-01',latest:'2025-02-01',status:'current',active:false,deleted_at:null},
  {id:'assignment-trash',worker_id:'worker-a',work_area_id:'area-a',assigned_date:'2025-01-01',ended_date:null,status:'required',active:true,deleted_at:'2026-01-01'}
 ]
});

test('Chemical Inventory is active-only, includes empty areas, preserves many-to-many placements, and sorts deterministically',()=>{
 const rows=chemicalInventoryReport(snapshot());
 assert.deepEqual(rows.map(row=>[row.workArea,row.productName]),[['Empty Area',''],['Mix Room','Cleaner, Heavy Duty'],['Mix Room','No SDS Product'],['Warehouse','Cleaner, Heavy Duty']]);
 assert.equal(rows.filter(row=>row.productName==='Cleaner, Heavy Duty').length,2);
 assert.equal(rows.some(row=>row.quantity==='removed'||row.productName==='Trashed Product'||row.workArea==='Trashed Area'),false);
 assert.deepEqual(rows.find(row=>row.productName==='No SDS Product'),{workAreaId:'area-a',workArea:'Mix Room',workAreaLocation:'Building A',productName:'No SDS Product',manufacturer:'Maker',casNumbers:'',quantity:'3 bottles',storageLocation:'Shelf',sdsDate:'2025-01-01',sdsPresent:'No',sdsVerificationStatus:'overdue',empty:false});
});

test('Chemical Inventory filters by Work Area and Product/CAS search without changing source data',()=>{
 const source=snapshot(),before=structuredClone(source);
 assert.deepEqual(chemicalInventoryReport(source,{workAreaId:'area-b'}).map(row=>row.workArea),['Warehouse']);
 assert.deepEqual(chemicalInventoryReport(source,{query:'67-64-1'}).map(row=>row.workArea),['Mix Room','Warehouse']);
 assert.deepEqual(chemicalInventoryReport(source,{query:'no sds'}).map(row=>row.productName),['No SDS Product']);
 assert.deepEqual(source,before);
});

test('Chemical Inventory remains Company/workspace isolated when given separate authorized snapshots',()=>{
 const primary=snapshot(),restored=snapshot();restored.work_area[1].name='Restored Mix Room';restored.work_area_product=restored.work_area_product.filter(row=>row.id!=='place-missing');
 assert.equal(chemicalInventoryReport(primary).some(row=>row.workArea==='Restored Mix Room'),false);
 assert.equal(chemicalInventoryReport(restored).some(row=>row.productName==='No SDS Product'),false);
});

test('CSV has fixed human-readable columns, CRLF rows, escaping, empty fields, and no internal IDs',()=>{
 const csv=reportCsv('chemicalInventory',chemicalInventoryReport(snapshot()));
 assert.match(csv,/^Work Area,Work Area Location,Product Name,Manufacturer,CAS Numbers,Quantity,Storage Location,SDS Date,SDS Present,SDS Verification Status\r\n/);
 assert.match(csv,/"Cleaner, Heavy Duty"/);assert.match(csv,/"Example ""Safety"""/);assert.match(csv,/"1\ncontainer"/);assert.match(csv,/Empty Area,Building B,,,,,,,No,/);
 assert.equal(csv.includes('area-a'),false);assert.equal(csv.includes('product-a'),false);assert.equal(csv.endsWith('\r\n'),true);assert.equal(csv,reportCsv('chemicalInventory',chemicalInventoryReport(snapshot())));
});

test('Compliance Status uses canonical current, required, approaching, overdue, and missing-SDS states',()=>{
 const source=snapshot();source.chemical_product.push({id:'product-approaching',product_name:'Approaching Product',manufacturer:'Maker',hasSds:true,latest:'2026-01-01',due:'2026-10-01',status:'approaching',deleted_at:null});source.work_area[0].status='overdue';source.work_area[0].latest='2025-01-01';source.work_area[1].status='current';source.work_area[2].status='required';
 const rows=complianceStatusReport(source);assert.deepEqual(new Set(rows.map(row=>row.status)),new Set(['current','overdue','approaching','missing SDS','required']));
 assert.equal(rows.find(row=>row.item==='No SDS Product').status,'missing SDS');assert.equal(rows.some(row=>row.item==='Trashed Product'||row.item==='Trashed Area'),false);
 assert.equal(reportCsv('complianceStatus',rows).includes('product-a'),false);
});

test('Training Status defaults to active assignments and can include ended history without trashed relationships',()=>{
 const active=trainingStatusReport(snapshot());assert.deepEqual(active.map(row=>row.worker),['Alpha Worker','Zulu Worker']);assert.deepEqual(active.map(row=>row.status),['current','required']);
 const history=trainingStatusReport(snapshot(),{includeHistorical:true});assert.equal(history.length,3);assert.equal(history.find(row=>row.endedDate)?.endedDate,'2025-12-01');assert.equal(reportCsv('trainingStatus',history).includes('assignment-current'),false);
});
