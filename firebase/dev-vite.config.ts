import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('./dev-auth',import.meta.url)),
  envDir:fileURLToPath(new URL('../',import.meta.url)),
  server:{host:'localhost',port:1421,strictPort:true},
});
