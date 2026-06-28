import semver from 'semver';

export type ChangedFile = {
  path: string;
  status: string;
};

export function requiresVersionBump(changedFiles: ChangedFile[], slug: string): boolean {
  return changedFiles.some((file) => {
    if (!file.path.startsWith(`scripts/${slug}/`)) return false;
    if (file.path === `scripts/${slug}/README.md`) return false;
    if (file.path.startsWith(`scripts/${slug}/assets/`)) return false;
    return true;
  });
}

export function assertVersionIncreased(oldVersion: string, newVersion: string, label: string): void {
  if (!semver.valid(newVersion)) {
    throw new Error(`${label}: new @version is not valid semver: ${newVersion}`);
  }
  if (!semver.valid(oldVersion)) {
    throw new Error(`${label}: old @version is not valid semver: ${oldVersion}`);
  }
  if (semver.lte(newVersion, oldVersion)) {
    throw new Error(`${label}: @version must increase (${oldVersion} -> ${newVersion})`);
  }
}
