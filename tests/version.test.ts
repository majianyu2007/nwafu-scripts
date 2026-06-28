import { describe, expect, it } from 'vitest';
import { assertVersionIncreased, requiresVersionBump } from '../tools/lib/version';

describe('version bump rules', () => {
  it('fails when script content changes without a higher version', () => {
    expect(requiresVersionBump([{ path: 'scripts/demo/script.user.js', status: 'M' }], 'demo')).toBe(
      true,
    );
    expect(() => assertVersionIncreased('1.0.0', '1.0.0', 'demo')).toThrow();
  });

  it('does not require a bump for README-only changes', () => {
    expect(requiresVersionBump([{ path: 'scripts/demo/README.md', status: 'M' }], 'demo')).toBe(
      false,
    );
  });

  it('rejects invalid semver', () => {
    expect(() => assertVersionIncreased('1.0.0', '1.0', 'demo')).toThrow();
  });
});
