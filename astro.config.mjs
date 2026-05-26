import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BASE_PATH } from './scripts/base.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  site: 'https://smart-geri-cds.yao.care',
  base: BASE_PATH || '/',
  integrations: [svelte(), sitemap()],
  output: 'static',
  vite: {
    resolve: {
      alias: {
        '$lib': path.resolve(__dirname, './src/lib'),
      },
    },
    worker: {
      format: 'es',
    },
  },
});
