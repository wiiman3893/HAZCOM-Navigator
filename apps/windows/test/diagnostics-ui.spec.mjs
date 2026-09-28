import {test,expect} from '@playwright/test';
async function nativeFixture(page,automated=false){await page.addInitScript(({automated})=>{
 window.isTauri=true;const state={current:null,sessions:[],failure:null},events=[];window.diagnosticTest={events,state,starts:0,marks:0,exports:0,fail:false};
 const start=()=>{state.current={sessionId:'diag_'+crypto.randomUUID().replaceAll('-',''),state:'active',startedMs:Date.now(),eventCount:0,droppedEvents:0};window.diagnosticTest.starts++;};if(automated)start();
 window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
  if(window.diagnosticTest.fail&&command!=='diagnostic_status')throw Error('synthetic failure');
  if(command==='diagnostic_status')return structuredClone(state);
  if(command==='diagnostic_start'){if(state.current?.state==='active')throw Error('already active');start();}
  if(command==='diagnostic_events'){events.push(...args.events);state.current.eventCount=events.length;}
  if(command==='diagnostic_mark'){window.diagnosticTest.marks++;events.push({operation:'diagnostics',outcome:'marked',...args.context});}
  if(command==='diagnostic_stop'){state.current.state='stopped';state.current.endedMs=Date.now();state.sessions.unshift(structuredClone(state.current));}
  if(command==='diagnostic_export'){window.diagnosticTest.exports++;return {filename:'hazcom-diagnostic-session-'+args.sessionId+'.zip'};}
 }};
},{automated});}
test('manual hotkey panel, no implicit recording, timer, marker, semantic CRUD, stop and export',async({page})=>{
 await nativeFixture(page);await page.goto('/');await expect(page.getByRole('heading',{name:'Management Home',exact:true})).toBeVisible();
 await page.keyboard.press('Control+Shift+M');expect(await page.evaluate(()=>window.diagnosticTest.marks)).toBe(0);
 await page.keyboard.press('Control+Shift+D');await expect(page.getByRole('complementary',{name:'Diagnostics'})).toHaveCount(0);
 await page.keyboard.press('Control+Shift+Alt+D');const panel=page.getByRole('complementary',{name:'Diagnostics'});await expect(panel).toBeVisible();expect(await page.evaluate(()=>window.diagnosticTest.starts)).toBe(0);
 await panel.getByRole('button',{name:'Start Diagnostic Session',exact:true}).click();await expect(page.getByRole('button',{name:/DIAGNOSTICS ACTIVE/})).toBeVisible();await expect(page.getByRole('button',{name:/DIAGNOSTICS ACTIVE · 00:00:0[1-9]/})).toBeVisible();
 await panel.getByRole('button',{name:'Close diagnostics'}).click();await page.getByRole('button',{name:'Workers',exact:true}).click();await page.getByRole('button',{name:'Add worker',exact:true}).click();const editor=page.getByRole('region',{name:'Record form'});await editor.getByLabel('Name',{exact:true}).fill('Private diagnostic fixture');await editor.getByRole('button',{name:'Save',exact:true}).click();await expect(editor).toHaveCount(0);
 await page.keyboard.press('Control+Shift+M');await expect.poll(()=>page.evaluate(()=>window.diagnosticTest.marks)).toBe(1);
 await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyM',ctrlKey:true,shiftKey:true,repeat:true})));expect(await page.evaluate(()=>window.diagnosticTest.marks)).toBe(1);
 await page.keyboard.press('Control+Shift+Alt+D');await panel.getByRole('button',{name:'Stop Diagnostic Session',exact:true}).click();await expect(page.getByRole('button',{name:/DIAGNOSTICS ACTIVE/})).toHaveCount(0);
 const events=await page.evaluate(()=>window.diagnosticTest.events);expect(events.some(e=>e.operation==='worker.create'&&e.outcome==='succeeded')).toBe(true);expect(events.some(e=>e.operation==='navigation'&&e.screen==='workers')).toBe(true);expect(JSON.stringify(events)).not.toContain('Private diagnostic fixture');
 await panel.getByRole('button',{name:'Export Diagnostic Package'}).click();await expect(panel.getByRole('status')).toContainText('Saved hazcom-diagnostic-session-');expect(await page.evaluate(()=>window.diagnosticTest.starts)).toBe(1);
});
test('automated active status and diagnostic write failure leave authoring usable; Member can open panel',async({page})=>{
 await nativeFixture(page,true);await page.goto('/');await expect(page.getByRole('button',{name:/DIAGNOSTICS ACTIVE/})).toBeVisible();await page.evaluate(()=>{window.diagnosticTest.fail=true;});
 await page.getByRole('button',{name:'Work Areas',exact:true}).click();await page.getByRole('button',{name:'Add work area',exact:true}).click();const editor=page.getByRole('region',{name:'Record form'});await editor.getByLabel('Name',{exact:true}).fill('Logging failure does not block save');await editor.getByRole('button',{name:'Save',exact:true}).click();await expect(editor).toHaveCount(0);
 await page.getByLabel('Test role').selectOption('member');await page.keyboard.press('Control+Shift+Alt+D');await expect(page.getByRole('heading',{name:'Diagnostics',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Company member access'})).toBeVisible();await expect(page.getByRole('button',{name:'Work Areas',exact:true})).toHaveCount(0);
});
