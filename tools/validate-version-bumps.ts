import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { getFirstMetadataValue, parseUserscript } from './lib/userscript';
import { assertVersionIncreased, requiresVersionBump, type ChangedFile } from './lib/version';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function hasGitHistory(): boolean {
  try {
    git(['rev-parse', '--is-inside-work-tree']);
    git(['rev-parse', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

function pickBaseRef(): string | undefined {
  const candidates = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : '',
    'origin/main',
    'HEAD~1',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      git(['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

function changedFiles(base: string): ChangedFile[] {
  return git(['diff', '--name-status', `${base}...HEAD`])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, filePath] = line.split(/\s+/);
      return { status, path: filePath };
    });
}

function slugsFromChanges(files: ChangedFile[]): string[] {
  const slugs = new Set<string>();
  for (const file of files) {
    const match = file.path.match(/^scripts\/([^/]+)\//);
    if (match) slugs.add(match[1]);
  }
  return [...slugs];
}

function versionAt(ref: string, slug: string): string | undefined {
  try {
    const source = git(['show', `${ref}:scripts/${slug}/script.user.js`]);
    return getFirstMetadataValue(parseUserscript(source).entries, 'version');
  } catch {
    return undefined;
  }
}

function versionNow(slug: string): string {
  const source = fs.readFileSync(`scripts/${slug}/script.user.js`, 'utf8');
  const version = getFirstMetadataValue(parseUserscript(source).entries, 'version');
  if (!version) throw new Error(`${slug}: missing @version`);
  return version;
}

if (!hasGitHistory()) {
  console.log('No Git history available; skipping version bump validation.');
  process.exit(0);
}

const base = pickBaseRef();
if (!base) {
  console.log('No comparison base found; skipping version bump validation.');
  process.exit(0);
}

const files = changedFiles(base);
for (const slug of slugsFromChanges(files)) {
  if (!requiresVersionBump(files, slug)) continue;
  const oldVersion = versionAt(base, slug);
  if (!oldVersion) continue;
  assertVersionIncreased(oldVersion, versionNow(slug), slug);
}

console.log(`Version bump validation passed against ${base}.`);
