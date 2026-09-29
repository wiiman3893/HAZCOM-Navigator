import {test,expect} from '@playwright/test';

test.beforeEach(async({context})=>{await context.clearCookies();});

test('restored identity stays behind live authorization and sign-out survives restart',async({page})=>{
 await page.goto('/entry.html?restored');
 await expect(page.getByRole('status')).toContainText(/Restoring Firebase|Checking your account/);
 expect(await page.evaluate(()=>window.workspaceTest.calls.some(value=>value.startsWith('ensure:')))).toBe(false);
 await expect(page.getByTestId('authoring-workspace')).toHaveText('primary');
 const calls=await page.evaluate(()=>window.workspaceTest.calls);
 expect(calls.indexOf('authorize:account-a/company-account-a')).toBeLessThan(calls.indexOf('ensure:account-a'));
 await page.goto('/entry.html');
 await expect(page.getByTestId('authoring-workspace')).toHaveText('primary');
 await page.getByRole('button',{name:'Sign out'}).click();
 await expect(page.getByRole('button',{name:'Sign in with Google'})).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('entry-test-user'))).toBeNull();
 await page.reload();
 await expect(page.getByRole('button',{name:'Sign in with Google'})).toBeVisible();
 await expect(page.getByTestId('authoring-workspace')).toHaveCount(0);
});

test('revoked or inactive access fails closed and retains persisted identity',async({page})=>{
 await page.goto('/entry.html?restored');await expect(page.getByTestId('authoring-workspace')).toHaveText('primary');
 await page.evaluate(()=>{window.workspaceTest.inactive=true;});
 await page.getByRole('button',{name:'Refresh access'}).click();
 await expect(page.getByRole('alert')).toContainText('Company access is no longer active');
 await expect(page.getByTestId('authoring-workspace')).toHaveCount(0);
 expect(await page.evaluate(()=>localStorage.getItem('entry-test-user'))).toBe('account-a');
});

test('revoked Membership and invalid Firebase session never retain a workspace',async({page})=>{
 await page.goto('/entry.html?restored');await expect(page.getByTestId('authoring-workspace')).toHaveText('primary');
 await page.evaluate(()=>{window.workspaceTest.revoked=true;});
 await page.getByRole('button',{name:'Refresh access'}).click();
 await expect(page.getByRole('alert')).toContainText('revoked');
 await expect(page.getByTestId('authoring-workspace')).toHaveCount(0);
 await page.evaluate(()=>{window.workspaceTest.revoked=false;window.workspaceTest.invalidate();});
 await expect(page.getByRole('alert')).toContainText('saved sign-in could not be validated');
 await expect(page.getByTestId('authoring-workspace')).toHaveCount(0);
});

test('offline startup blocks authoring and online retry reauthorizes',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('entry-test-user','account-a');});
 await page.goto('/entry.html');
 await page.evaluate(()=>{window.workspaceTest.offline=true;window.dispatchEvent(new Event('offline'));});
 await expect(page.getByRole('alert')).toContainText('Connect to the internet');
 await expect(page.getByTestId('authoring-workspace')).toHaveCount(0);
 await page.evaluate(()=>{window.workspaceTest.offline=false;window.dispatchEvent(new Event('online'));});
 await expect(page.getByTestId('authoring-workspace')).toHaveText('primary');
});

test('account switch closes A and authorizes B before opening B workspace',async({page})=>{
 await page.goto('/entry.html?restored');await expect(page.getByTestId('authoring-workspace')).toHaveText('primary');
 const before=await page.evaluate(()=>window.workspaceTest.calls.length);
 await page.evaluate(()=>window.workspaceTest.switchAccount('account-b'));
 await expect(page.getByRole('combobox',{name:'Active Company'})).toHaveValue('company-account-b');
 const calls=await page.evaluate(start=>window.workspaceTest.calls.slice(start),before);
 expect(calls.indexOf('close')).toBeLessThan(calls.indexOf('authorize:account-b/company-account-b'));
 expect(calls.indexOf('authorize:account-b/company-account-b')).toBeLessThan(calls.indexOf('ensure:account-b'));
 await expect(page.getByText('Company account-a',{exact:true})).toHaveCount(0);
});
