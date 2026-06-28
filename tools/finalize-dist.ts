import fs from 'node:fs/promises';
import path from 'node:path';
import { absoluteUrl } from '../site.config';

async function main(): Promise<void> {
  const dist = path.join(process.cwd(), 'dist');
  await fs.writeFile(path.join(dist, '.nojekyll'), '');
  await fs.writeFile(
    path.join(dist, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('/sitemap-index.xml')}\n`,
  );
  await fs.rm(path.join(dist, 'CNAME'), { force: true });
  console.log('Finalized dist with .nojekyll and no CNAME.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
