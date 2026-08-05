import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Deliberately bare: no aliases, no optimizeDeps, no ssr.noExternal.
//
// Every one of those is a way for a host to paper over a package that does not
// resolve on its own, and this harness exists to find out whether they resolve
// on their own. A consumer that needs special Vite config to use these packages
// is a bug here, not a note in their README.
export default defineConfig({ plugins: [react()] });
