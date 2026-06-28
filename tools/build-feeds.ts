import fs from 'node:fs/promises';
import path from 'node:path';
import { absoluteUrl, siteConfig } from '../site.config';

type ScriptItem = {
  name: string;
  description: string;
  pagePath: string;
  verified: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main(): Promise<void> {
  const manifestPath = path.join(process.cwd(), 'src/generated/scripts.json');
  const scripts = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ScriptItem[];
  const items = scripts
    .slice()
    .sort((a, b) => b.verified.localeCompare(a.verified))
    .slice(0, 20);

  const rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>NWAFU Scripts</title>
    <link>${absoluteUrl('/')}</link>
    <description>西北农林科技大学网站增强脚本集</description>
    ${items
      .map(
        (item) => `<item>
      <title>${escapeXml(item.name)}</title>
      <link>${absoluteUrl(item.pagePath)}</link>
      <guid>${absoluteUrl(item.pagePath)}</guid>
      <pubDate>${new Date(`${item.verified}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeXml(item.description)}</description>
    </item>`,
      )
      .join('\n    ')}
  </channel>
</rss>
`;

  const atom = `<?xml version="1.0" encoding="UTF-8" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>NWAFU Scripts</title>
  <id>${absoluteUrl('/')}</id>
  <link href="${absoluteUrl('/')}"/>
  <updated>${new Date().toISOString()}</updated>
  <author><name>${escapeXml(siteConfig.author)}</name></author>
  ${items
    .map(
      (item) => `<entry>
    <title>${escapeXml(item.name)}</title>
    <id>${absoluteUrl(item.pagePath)}</id>
    <link href="${absoluteUrl(item.pagePath)}"/>
    <updated>${new Date(`${item.verified}T00:00:00Z`).toISOString()}</updated>
    <summary>${escapeXml(item.description)}</summary>
  </entry>`,
    )
    .join('\n  ')}
</feed>
`;

  await fs.writeFile(path.join(process.cwd(), 'dist/feed.xml'), rss);
  await fs.writeFile(path.join(process.cwd(), 'dist/atom.xml'), atom);
  console.log('Generated RSS and Atom feeds.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
