import {test,expect} from '@playwright/test';
const selector=page=>page.getByRole('combobox',{name:'Local workspace · Workspace Company'});
test('actual workspace selector routes authoring/publication and preserves selection after failure/reload',async({page})=>{
 await page.goto('/workspace.html?fail');await expect(selector(page)).toHaveValue('primary');
 await selector(page).selectOption('restored-a');await expect(page.getByTestId('authoring-workspace')).toHaveText('restored-a');await expect(page.getByTestId('publication-workspace')).toHaveText('restored-a');
 await selector(page).selectOption('restored-b');await expect(page.getByRole('status')).toHaveText('WORKSPACE_INTEGRITY_FAILED');await expect(selector(page)).toHaveValue('restored-a');await expect(page.getByTestId('authoring-workspace')).toHaveText('restored-a');
 await expect(selector(page).locator('option[value="restored-broken"]')).toHaveJSProperty('disabled',true);
 await page.reload();await expect(selector(page)).toHaveValue('restored-a');await expect(page.getByTestId('publication-workspace')).toHaveText('restored-a');
 await page.evaluate(()=>window.addEventListener('hazcom:before-navigation',e=>e.preventDefault(),{once:true}));
 await selector(page).selectOption('primary');await expect(selector(page)).toHaveValue('restored-a');
});
test('startup fallback is visible; read/export mode hides authoring and exports selected workspace',async({page})=>{
 await page.goto('/workspace.html');await page.evaluate(()=>localStorage.setItem('workspace-test-selection','restored-missing'));
 await page.goto('/workspace.html?readonly');await expect(page.getByRole('status')).toContainText('Saved workspace unavailable');await expect(page.getByRole('heading',{name:'Read and export workspace'})).toBeVisible();await expect(page.getByTestId('authoring-workspace')).toHaveCount(0);
 await selector(page).selectOption('restored-a');const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export Company backup'}).click();await download;
 expect(await page.evaluate(()=>window.workspaceTest.calls)).toContain('export:restored-a');
});
test('Member view never opens a local authoring workspace',async({page})=>{
 await page.goto('/workspace.html?role=member');await expect(page.getByRole('heading',{name:'Company member access'})).toBeVisible();expect(await page.evaluate(()=>window.workspaceTest.calls)).toEqual([]);await expect(selector(page)).toHaveCount(0);
});
