import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'auth-persistence.spec.mjs',workers:1,timeout:90000,use:{headless:true},webServer:{command:'node apps/windows/test/ui-server.mjs',cwd:'../../..',url:'http://127.0.0.1:1435',reuseExistingServer:false,timeout:30000},reporter:'list'});
