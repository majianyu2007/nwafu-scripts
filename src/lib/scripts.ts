import manifest from '../generated/scripts.json';

export type ScriptItem = (typeof manifest)[number];

export const scripts = manifest as ScriptItem[];

export function activeScripts(): ScriptItem[] {
  return scripts.filter((script) => script.status === 'stable' || script.status === 'beta');
}

export function archivedScripts(): ScriptItem[] {
  return scripts.filter((script) => script.status === 'paused' || script.status === 'deprecated');
}

export function featuredScripts(): ScriptItem[] {
  return activeScripts().filter((script) => script.featured);
}

export function recentScripts(limit = 4): ScriptItem[] {
  return [...scripts].sort((a, b) => b.verified.localeCompare(a.verified)).slice(0, limit);
}

export function findScript(slug: string): ScriptItem | undefined {
  return scripts.find((script) => script.slug === slug);
}
