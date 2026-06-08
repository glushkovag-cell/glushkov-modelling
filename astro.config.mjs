// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.glushkov-modelling.com',  // ДОБАВЛЕНО: обязательно для sitemap
  trailingSlash: 'never',
  output: 'static',
  adapter: node({
    mode: 'standalone'
  }),
  integrations: [
    sitemap({
      // Исключаем технические страницы если появятся
      filter: (page) => !page.includes('/wp-admin') && !page.includes('/graphql'),
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
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
