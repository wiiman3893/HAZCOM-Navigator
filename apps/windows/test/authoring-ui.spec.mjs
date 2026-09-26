import {test,expect} from '@playwright/test';
import {dummyPdf} from '../../../packages/sync/test/fixtures.mjs';
import {PDFDocument,StandardFonts} from 'pdf-lib';

async function bulkPdf(){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 for(const text of [
  'SAFETY DATA SHEET\nSECTION 1: IDENTIFICATION\nProduct identifier: UI Product Alpha\nPage 1 of 2',
  'SECTION 16: OTHER INFORMATION\nPage 2 of 2',
  'SAFETY DATA SHEET\nSECTION 1: IDENTIFICATION\nProduct identifier: UI Product Beta\nPage 1 of 2',
  'SECTION 16: OTHER INFORMATION\nPage 2 of 2'
 ]){const page=doc.addPage([612,792]);page.drawText(text,{x:40,y:740,size:11,font,lineHeight:15});}
 return Buffer.from(await doc.save({useObjectStreams:false}));
}
test('Navigation, form preservation, Work Area CRUD/trash/restore and Company switch',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.getByRole('heading',{name:'Management Home',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Work Areas',exact:true}).click();await page.getByRole('button',{name:'Add work area',exact:true}).click();
 const editor=page.getByRole('region',{name:'Record form'});const value=`UI Work Area ${Date.now()}`;await editor.getByLabel('Name',{exact:true}).fill(value);await editor.getByLabel('Location',{exact:true}).fill('Building Z');
 await page.getByRole('button',{name:'Workers',exact:true}).click();await expect(page.getByText('Save or cancel the open form before leaving.')).toBeVisible();await expect(editor.getByLabel('Name',{exact:true})).toHaveValue(value);
 await page.getByLabel('Test Company').selectOption('empty-company');await expect(page.getByLabel('Test Company')).toHaveValue('ui-company');
 await editor.getByRole('button',{name:'Save',exact:true}).click();await expect(editor).toHaveCount(0);await page.getByLabel('Search',{exact:true}).fill(value);await page.getByRole('button',{name:'View details'}).click();await expect(page.getByRole('heading',{name:value,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit',exact:true}).click();await editor.getByLabel('Location',{exact:true}).fill('Building Q');await editor.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('dd').filter({hasText:'Building Q'})).toBeVisible();
 await page.getByRole('button',{name:'Move to Trash'}).click();await expect(page.getByRole('button',{name:'Restore',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'View',exact:true}).selectOption('trash');await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Restore',exact:true}).click();await page.getByRole('combobox',{name:'View',exact:true}).selectOption('active');await expect(page.getByRole('cell',{name:value,exact:true})).toBeVisible();
 await page.getByLabel('Test Company').selectOption('empty-company');await expect(page.getByRole('heading',{name:'Management Home',exact:true})).toBeVisible();await page.getByRole('button',{name:'Work Areas',exact:true}).click();await expect(page.getByText('No records match. Create a record or clear filters.')).toBeVisible();await expect(page.getByRole('heading',{name:value,exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});
test('Chemical SDS upload/verification, assignment training, reviews, filters and role routing',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Chemical Library',exact:true}).click();await page.getByLabel('Search',{exact:true}).fill('67-64-1');await page.getByRole('button',{name:'View details'}).click();await expect(page.getByText('Local draft SDS',{exact:true})).toBeVisible();
 await page.getByLabel('Choose / replace PDF').setInputFiles({name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from(dummyPdf('UI safe PDF'))});await expect(page.getByText(/Current draft · synthetic.pdf/)).toBeVisible();
 await page.getByRole('button',{name:'Verify SDS current'}).click();await page.getByRole('region',{name:'Record form'}).getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('region',{name:'Record form'})).toHaveCount(0);await expect(page.locator('.badge.current').first()).toBeVisible();
 await page.getByRole('button',{name:'Assignments & Training',exact:true}).click();await page.getByRole('button',{name:'Add assignment'}).click();let editor=page.getByRole('region',{name:'Record form'});await editor.getByRole('combobox',{name:'Work Area',exact:true}).selectOption('ui-area');await editor.getByRole('combobox',{name:'Worker',exact:true}).selectOption('ui-worker');await editor.getByRole('button',{name:'Save',exact:true}).click();await expect(editor).toHaveCount(0);await expect(page.getByText('Required',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Record training'}).click();await editor.getByRole('button',{name:'Save',exact:true}).click();await expect(editor).toHaveCount(0);await expect(page.locator('.badge.current')).toBeVisible();
 await page.getByRole('button',{name:'Workers',exact:true}).click();await page.getByRole('combobox',{name:'Training',exact:true}).selectOption('assigned');await expect(page.getByRole('cell',{name:'Synthetic Worker',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Work Areas',exact:true}).click();await page.getByLabel('Search',{exact:true}).fill('Maintenance');await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Record HAZCOM review'}).click();await editor.getByRole('button',{name:'Save',exact:true}).click();await expect(editor).toHaveCount(0);await expect(page.getByText(/Next due:/)).toBeVisible();
 await page.getByRole('button',{name:'Company & Access Administration',exact:true}).click();await expect(page.getByText(/require an Administrator/)).toBeVisible();await page.getByRole('button',{name:'Reports & Export',exact:true}).click();await expect(page.getByRole('heading',{name:'Publication and reports status'})).toBeVisible();
 await page.getByLabel('Test role').selectOption('member');await expect(page.getByRole('heading',{name:'Company member access'})).toBeVisible();await expect(page.getByRole('button',{name:'Work Areas',exact:true})).toHaveCount(0);
});
test('Readable desktop layouts, invalid input retained and empty search states',async({page})=>{
 await page.goto('/');for(const width of [1320,1000]){await page.setViewportSize({width,height:860});for(const name of ['Management Home','Work Areas','Chemical Library','Workers','Assignments & Training','Reports & Export','Company & Access Administration']){await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}}
 await page.getByRole('button',{name:'Chemical Library',exact:true}).click();await page.getByRole('button',{name:'Add chemical product'}).click();const form=page.getByRole('region',{name:'Record form'});await form.getByLabel('Product name').fill('Invalid CAS retained');await form.getByLabel('Manufacturer').fill('Test');await form.getByLabel('CAS numbers').fill('not-a-CAS');await form.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('alert')).toContainText('CAS numbers');await expect(form.getByLabel('CAS numbers')).toHaveValue('not-a-CAS');await form.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByLabel('Search',{exact:true}).fill('no match deliberately');await expect(page.getByText('No records match. Create a record or clear filters.')).toBeVisible();
});

test('Paid Manager publishes a Company draft and sees later unpublished changes',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Chemical Library',exact:true}).click();
 await page.getByLabel('Search',{exact:true}).fill('67-64-1');
 await page.getByRole('button',{name:'View details'}).click();
 await page.getByLabel('Choose / replace PDF').setInputFiles({name:'publication-synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from(dummyPdf('Publication UI'))});
 await expect(page.getByText(/Current draft · publication-synthetic.pdf/)).toBeVisible();
 await page.getByRole('button',{name:'Work Areas',exact:true}).click();
 await page.getByLabel('Search',{exact:true}).fill('Maintenance');
 await page.getByRole('button',{name:'View details'}).click();
 await page.getByRole('button',{name:'Add Chemical to Work Area'}).click();
 const form=page.getByRole('region',{name:'Record form'});
 await form.getByRole('combobox',{name:'Chemical Product'}).selectOption('ui-chemical');
 await form.getByLabel('Quantity').fill('2 bottles');
 await form.getByLabel('Storage location').fill('Cabinet A');
 await form.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('button',{name:'Reports & Export',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Readiness: READY'})).toBeVisible();
 await page.getByRole('button',{name:'Publish Company'}).click();
 await expect(page.getByText('Publication completed. This is now the current published HazCom revision.')).toBeVisible();
 await expect(page.getByText(/Current published revision 1/)).toBeVisible();
 await page.getByRole('button',{name:'Work Areas',exact:true}).click();
 await page.getByLabel('Search',{exact:true}).fill('Maintenance');
 await page.getByRole('button',{name:'View details'}).click();
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 await form.getByLabel('Location',{exact:true}).fill('Updated shop location');
 await form.getByRole('button',{name:'Save',exact:true}).click();
 await page.getByRole('button',{name:'Reports & Export',exact:true}).click();
 await expect(page.getByText('Local changes have not yet been published.')).toBeVisible();
});

test('Publication gives visible Demo and grace reasons',async({page})=>{
 await page.goto('/');
 for(const [value,reason] of [['company-demo','current plan'],['pro-demo','current plan'],['grace','read/export period'],['expired','coverage is inactive']]){
  await page.getByLabel('Test entitlement').selectOption(value);
  await page.getByRole('button',{name:'Reports & Export',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Readiness: BLOCKING'})).toBeVisible();
  await expect(page.getByText(new RegExp(reason))).toBeVisible();
  await expect(page.getByRole('button',{name:'Publish Company'})).toBeDisabled();
 }
});


test('Bulk SDS Import proposes boundaries, allows correction and persists reviewed drafts',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Chemical Library',exact:true}).click();
 await page.getByRole('button',{name:'Import SDS Batch',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Import SDS Batch',exact:true})).toBeVisible();
 await page.getByLabel('Select batch PDF').setInputFiles({name:'synthetic-stack.pdf',mimeType:'application/pdf',buffer:await bulkPdf()});
 await expect(page.getByRole('heading',{name:'SDS Batch — 4 pages',exact:true})).toBeVisible();
 await expect(page.getByText('UI Product Alpha',{exact:true})).toBeVisible();
 await expect(page.getByText('UI Product Beta',{exact:true})).toBeVisible();
 await expect(page.getByText('Likely boundary',{exact:true}).first()).toBeVisible();

 let cards=page.locator('article.candidate-card');
 await expect(cards).toHaveCount(2);
 await cards.nth(1).getByRole('button',{name:'Merge With Previous',exact:true}).click();
 await expect(cards).toHaveCount(1);
 await expect(cards.first().getByText('Pages 1–4',{exact:true})).toBeVisible();

 await cards.first().getByLabel('Split page candidate 1').fill('3');
 await cards.first().getByRole('button',{name:'Split Here',exact:true}).click();
 cards=page.locator('article.candidate-card');
 await expect(cards).toHaveCount(2);
 await expect(cards.nth(1).getByText('Pages 3–4',{exact:true})).toBeVisible();
 await expect(cards.nth(1).getByText('Manual boundary',{exact:true})).toBeVisible();

 await page.getByRole('button',{name:'Save review drafts',exact:true}).click();
 await expect(page.getByRole('button',{name:'View draft PDF',exact:true})).toHaveCount(2,{timeout:15000});
 await expect(page.getByText(/Review drafts saved/).first()).toBeVisible();

 await page.reload();
 await page.getByRole('button',{name:'Chemical Library',exact:true}).click();
 await page.getByRole('button',{name:'Import SDS Batch',exact:true}).click();
 await expect(page.getByRole('heading',{name:'SDS Batch — 4 pages',exact:true})).toBeVisible();
 await expect(page.getByText(/Review drafts saved/).first()).toBeVisible();
 await expect(page.locator('article.candidate-card')).toHaveCount(2);
});
