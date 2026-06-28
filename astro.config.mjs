import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { siteConfig } from './site.config.ts';

export default defineConfig({
  output: 'static',
  site: siteConfig.siteUrl,
  base: siteConfig.basePath || '/',
  trailingSlash: 'always',
  integrations: [sitemap()],
});
