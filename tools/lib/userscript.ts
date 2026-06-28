import { siteConfig, scriptPageUrl, userscriptUrl } from '../../site.config';

export type MetadataEntry = {
  key: string;
  value: string;
  raw: string;
};

export type ParsedUserscript = {
  header: string;
  entries: MetadataEntry[];
  body: string;
};

export const managedMetadataKeys = new Set([
  'namespace',
  'author',
  'license',
  'homepageURL',
  'supportURL',
  'updateURL',
  'downloadURL',
]);

export function parseUserscript(source: string): ParsedUserscript {
  const match = source.match(/\/\/ ==UserScript==\r?\n([\s\S]*?)\r?\n\/\/ ==\/UserScript==/);
  if (!match || match.index === undefined) {
    throw new Error('Missing Userscript metadata block');
  }
  const block = match[1];
  const entries: MetadataEntry[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const tag = rawLine.match(/^\s*\/\/\s*@([^\s]+)\s*(.*)$/);
    if (!tag) continue;
    entries.push({ key: tag[1], value: tag[2].trim(), raw: rawLine });
  }
  return {
    header: source.slice(0, match.index),
    entries,
    body: source.slice(match.index + match[0].length),
  };
}

export function getMetadataValues(entries: MetadataEntry[], key: string): string[] {
  return entries.filter((entry) => entry.key === key).map((entry) => entry.value);
}

export function getFirstMetadataValue(entries: MetadataEntry[], key: string): string | undefined {
  return getMetadataValues(entries, key)[0];
}

export function buildManagedMetadata(slug: string): MetadataEntry[] {
  return [
    {
      key: 'namespace',
      value: `${siteConfig.siteUrl}${siteConfig.basePath}/`,
      raw: '',
    },
    { key: 'author', value: siteConfig.author, raw: '' },
    { key: 'license', value: siteConfig.licenseName, raw: '' },
    { key: 'homepageURL', value: scriptPageUrl(slug), raw: '' },
    { key: 'supportURL', value: `${siteConfig.repositoryUrl}/issues`, raw: '' },
    { key: 'updateURL', value: userscriptUrl(slug), raw: '' },
    { key: 'downloadURL', value: userscriptUrl(slug), raw: '' },
  ];
}

export function injectProjectMetadata(source: string, slug: string): string {
  const parsed = parseUserscript(source);
  const userEntries = parsed.entries.filter((entry) => !managedMetadataKeys.has(entry.key));
  const entries = [...userEntries, ...buildManagedMetadata(slug)];
  const maxKey = Math.max(...entries.map((entry) => entry.key.length));
  const lines = [
    '// ==UserScript==',
    ...entries.map((entry) => `// @${entry.key.padEnd(maxKey)} ${entry.value}`.trimEnd()),
    '// ==/UserScript==',
  ];
  return `${parsed.header}${lines.join('\n')}${parsed.body}`;
}
