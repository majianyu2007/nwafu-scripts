import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import semver from 'semver';
import { ZodError } from 'zod';
import { absoluteUrl, issuesUrl, scriptPagePath, userscriptPath } from '../site.config';
import {
  getFirstMetadataValue,
  getMetadataValues,
  injectProjectMetadata,
  parseUserscript,
} from './lib/userscript';
import { parseReadme } from './lib/readme';
import { isValidSlug } from './lib/slug';

const root = process.cwd();
const generatedSrc = path.join(root, 'src/generated');
const generatedPublic = path.join(root, 'public/generated');
const publicUserscripts = path.join(root, 'public/userscripts');
const scriptsRoot = path.join(root, 'scripts');
const assetExtensions = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg']);

export type ScriptManifestItem = {
  slug: string;
  name: string;
  version: string;
  description: string;
  summary: string;
  category: string;
  tags: string[];
  status: 'stable' | 'beta' | 'paused' | 'deprecated';
  verified: string;
  featured: boolean;
  title_en: string;
  summary_en: string;
  legacy_slugs: string[];
  matches: string[];
  includes: string[];
  excludes: string[];
  grants: string[];
  requires: string[];
  resources: string[];
  runAt: string[];
  connects: string[];
  icon?: string;
  noframes: boolean;
  installPath: string;
  installUrl: string;
  pagePath: string;
  pageUrl: string;
  sourceUrl: string;
  issueUrl: string;
  readme: string;
  matchSummary: string[];
  assets: string[];
  updatedAt: string;
};

function fail(message: string): never {
  throw new Error(message);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function summarizeMatches(values: string[]): string[] {
  return values.map((value) => {
    try {
      const url = new URL(value.replace('*://', 'https://').replace(/\*/g, ''));
      return url.hostname || value;
    } catch {
      return value;
    }
  });
}

function extractReadmeSummary(markdown: string): string {
  const paragraph = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith('#') && !block.startsWith('- '));
  return paragraph ? paragraph.replace(/\s+/g, ' ') : '';
}

async function copyAssets(slug: string): Promise<string[]> {
  const assetsDir = path.join(scriptsRoot, slug, 'assets');
  if (!(await exists(assetsDir))) return [];
  const files = await fg('**/*', { cwd: assetsDir, onlyFiles: true });
  const copied: string[] = [];
  for (const file of files) {
    if (!assetExtensions.has(path.extname(file).toLowerCase())) continue;
    const from = path.join(assetsDir, file);
    const to = path.join(generatedPublic, 'scripts', slug, 'assets', file);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    copied.push(`/generated/scripts/${slug}/assets/${file}`);
  }
  return copied.sort();
}

async function collectScripts(validateOnly = false): Promise<ScriptManifestItem[]> {
  const scriptFiles = await fg('*/script.user.js', { cwd: scriptsRoot, onlyFiles: true });
  const slugs = scriptFiles.map((file) => file.split('/')[0]).sort();
  const seenNames = new Map<string, string>();
  const seenLegacy = new Map<string, string>();
  const manifest: ScriptManifestItem[] = [];

  for (const slug of slugs) {
    if (!slug || !isValidSlug(slug)) fail(`${slug}: slug must be lower-case kebab-case`);
    const scriptPath = path.join(scriptsRoot, slug, 'script.user.js');
    const readmePath = path.join(scriptsRoot, slug, 'README.md');
    if (!(await exists(readmePath))) fail(`${slug}: missing README.md`);

    const source = await fs.readFile(scriptPath, 'utf8');
    const parsed = parseUserscript(source);
    const readmeSource = await fs.readFile(readmePath, 'utf8');
    let readme;
    try {
      readme = parseReadme(readmeSource);
    } catch (error) {
      if (error instanceof ZodError) {
        fail(`${slug}: invalid README front matter: ${error.issues.map((issue) => issue.message).join('; ')}`);
      }
      throw error;
    }

    const name = getFirstMetadataValue(parsed.entries, 'name') || fail(`${slug}: missing @name`);
    const version = getFirstMetadataValue(parsed.entries, 'version') || fail(`${slug}: missing @version`);
    const description =
      getFirstMetadataValue(parsed.entries, 'description') || fail(`${slug}: missing @description`);
    if (!semver.valid(version)) fail(`${slug}: @version must be valid semver, got ${version}`);

    const matches = getMetadataValues(parsed.entries, 'match');
    const includes = getMetadataValues(parsed.entries, 'include');
    if (matches.length === 0 && includes.length === 0) fail(`${slug}: missing @match or @include`);

    if (seenNames.has(name)) fail(`${slug}: duplicate @name with ${seenNames.get(name)}`);
    seenNames.set(name, slug);
    for (const legacySlug of readme.data.legacy_slugs) {
      if (!isValidSlug(legacySlug)) fail(`${slug}: invalid legacy slug ${legacySlug}`);
      if (legacySlug === slug) fail(`${slug}: legacy slug cannot equal canonical slug`);
      const owner = seenLegacy.get(legacySlug);
      if (owner) fail(`${slug}: legacy slug ${legacySlug} already used by ${owner}`);
      seenLegacy.set(legacySlug, slug);
    }

    if (!validateOnly) {
      const output = injectProjectMetadata(source, slug);
      const outPath = path.join(generatedPublic, 'userscripts', `${slug}.user.js`);
      const stableOutPath = path.join(publicUserscripts, `${slug}.user.js`);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.mkdir(path.dirname(stableOutPath), { recursive: true });
      await fs.writeFile(outPath, output);
      await fs.writeFile(stableOutPath, output);
      for (const legacySlug of readme.data.legacy_slugs) {
        const legacyOut = path.join(generatedPublic, 'userscripts', `${legacySlug}.user.js`);
        const stableLegacyOut = path.join(publicUserscripts, `${legacySlug}.user.js`);
        await fs.writeFile(legacyOut, output);
        await fs.writeFile(stableLegacyOut, output);
      }
    }

    const assets = validateOnly ? [] : await copyAssets(slug);
    manifest.push({
      slug,
      name,
      version,
      description,
      summary: extractReadmeSummary(readme.content) || description,
      category: readme.data.category,
      tags: readme.data.tags,
      status: readme.data.status,
      verified: readme.data.verified,
      featured: readme.data.featured,
      title_en: readme.data.title_en,
      summary_en: readme.data.summary_en,
      legacy_slugs: readme.data.legacy_slugs,
      matches,
      includes,
      excludes: getMetadataValues(parsed.entries, 'exclude'),
      grants: getMetadataValues(parsed.entries, 'grant'),
      requires: getMetadataValues(parsed.entries, 'require'),
      resources: getMetadataValues(parsed.entries, 'resource'),
      runAt: getMetadataValues(parsed.entries, 'run-at'),
      connects: getMetadataValues(parsed.entries, 'connect'),
      icon: getFirstMetadataValue(parsed.entries, 'icon'),
      noframes: getMetadataValues(parsed.entries, 'noframes').length > 0,
      installPath: userscriptPath(slug),
      installUrl: absoluteUrl(userscriptPath(slug)),
      pagePath: scriptPagePath(slug),
      pageUrl: absoluteUrl(scriptPagePath(slug)),
      sourceUrl: `${process.env.REPOSITORY_URL || 'https://github.com/majianyu2007/nwafu-scripts'}/tree/main/scripts/${slug}`,
      issueUrl: issuesUrl(`[${name}] `),
      readme: readme.content,
      matchSummary: summarizeMatches([...matches, ...includes]),
      assets,
      updatedAt: readme.data.verified,
    });
  }

  return manifest.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

async function main(): Promise<void> {
  const validateOnly = process.argv.includes('--validate-only');
  if (!validateOnly) {
    await fs.rm(generatedSrc, { recursive: true, force: true });
    await fs.rm(generatedPublic, { recursive: true, force: true });
    await fs.rm(publicUserscripts, { recursive: true, force: true });
    await fs.mkdir(generatedSrc, { recursive: true });
    await fs.mkdir(generatedPublic, { recursive: true });
  }
  const manifest = await collectScripts(validateOnly);
  if (!validateOnly) {
    await fs.writeFile(
      path.join(generatedSrc, 'scripts.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await fs.writeFile(
      path.join(generatedPublic, 'search-index.json'),
      `${JSON.stringify(
        manifest.map((item) => ({
          slug: item.slug,
          name: item.name,
          title_en: item.title_en,
          description: item.description,
          summary: item.summary,
          summary_en: item.summary_en,
          category: item.category,
          tags: item.tags,
          status: item.status,
          version: item.version,
          matches: [...item.matches, ...item.includes],
          matchSummary: item.matchSummary,
          grants: item.grants,
          requires: item.requires,
          connects: item.connects,
        })),
        null,
        2,
      )}\n`,
    );
  }
  console.log(`${validateOnly ? 'Validated' : 'Generated'} ${manifest.length} scripts.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
