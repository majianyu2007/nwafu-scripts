export type SiteConfig = {
  siteUrl: string;
  basePath: string;
  repositoryUrl: string;
  author: string;
  licenseName: string;
  adsenseClient: string;
  umamiScriptUrl: string;
  umamiWebsiteId: string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeBasePath(value: string): string {
  if (!value || value === '/') return '';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

export const siteConfig: SiteConfig = {
  siteUrl: trimTrailingSlash(process.env.SITE_URL || 'https://mjy.js.org'),
  basePath: normalizeBasePath(process.env.BASE_PATH || '/nwafu-scripts'),
  repositoryUrl:
    process.env.REPOSITORY_URL || 'https://github.com/majianyu2007/nwafu-scripts',
  author: process.env.AUTHOR || 'majianyu2007',
  licenseName: process.env.LICENSE_NAME || 'MIT',
  adsenseClient: process.env.PUBLIC_ADSENSE_CLIENT || 'ca-pub-9101785228583606',
  umamiScriptUrl: process.env.PUBLIC_UMAMI_SCRIPT_URL || 'https://umami.715654.xyz/script.js',
  umamiWebsiteId: process.env.PUBLIC_UMAMI_WEBSITE_ID || '6bc518c3-c5f9-4afd-8edf-fe258aba7432',
};

export function withBasePath(path = '/'): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const suffix = cleanPath === '/' ? '/' : cleanPath;
  return `${siteConfig.basePath}${suffix}` || '/';
}

export function absoluteUrl(path = '/'): string {
  return `${siteConfig.siteUrl}${withBasePath(path)}`;
}

export function scriptPagePath(slug: string, lang: 'zh' | 'en' = 'zh'): string {
  return lang === 'en' ? `/en/scripts/${slug}/` : `/scripts/${slug}/`;
}

export function scriptPageUrl(slug: string, lang: 'zh' | 'en' = 'zh'): string {
  return absoluteUrl(scriptPagePath(slug, lang));
}

export function userscriptPath(slug: string): string {
  return `/userscripts/${slug}.user.js`;
}

export function userscriptUrl(slug: string): string {
  return absoluteUrl(userscriptPath(slug));
}

export function issuesUrl(title?: string): string {
  const url = new URL(`${siteConfig.repositoryUrl}/issues/new`);
  if (title) url.searchParams.set('title', title);
  return url.toString();
}
