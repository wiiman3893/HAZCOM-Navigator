import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Cargo writes and locks files under src-tauri/target while Tauri builds.
      // Vite only needs to watch the frontend source tree; watching Rust build
      // output on Windows can fail with EBUSY when Cargo has an object file open.
      ignored: ['**/src-tauri/target/**'],
    },
  },
});
