import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { siteConfig } from '../site.config';

type Entry = {
  title: string;
  date: string;
  sha: string;
  url: string;
  scripts: string[];
};

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  let entries: Entry[] = [];
  try {
    git(['rev-parse', '--is-inside-work-tree']);
    const log = git(['log', '-n', '30', '--date=short', '--pretty=format:%H%x09%ad%x09%s']);
    entries = log
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, date, title] = line.split('\t');
        let scripts: string[] = [];
        try {
          scripts = git(['show', '--name-only', '--pretty=format:', sha])
            .split('\n')
            .map((file) => file.match(/^scripts\/([^/]+)\//)?.[1])
            .filter((value): value is string => Boolean(value));
          scripts = [...new Set(scripts)];
        } catch {
          scripts = [];
        }
        return {
          title,
          date,
          sha: sha.slice(0, 7),
          url: `${siteConfig.repositoryUrl}/commit/${sha}`,
          scripts,
        };
      });
  } catch {
    entries = [
      {
        title: '本地构建：未发现可用 Git 历史',
        date: new Date().toISOString().slice(0, 10),
        sha: 'local',
        url: siteConfig.repositoryUrl,
        scripts: [],
      },
    ];
  }

  const out = path.join(process.cwd(), 'src/generated/changelog.json');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`Generated changelog with ${entries.length} entries.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
