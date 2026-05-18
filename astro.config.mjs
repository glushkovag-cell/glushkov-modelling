// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'static',
  adapter: node({
    mode: 'standalone'
  }),
  scopedStyleStrategy: 'class',
  build: {
    inlineStylesheets: 'auto'
  },
  vite: {
    build: {
      cssMinify: 'lightningcss'
    }
  }
});