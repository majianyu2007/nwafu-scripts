import { describe, expect, it } from 'vitest';
import { absoluteUrl, userscriptUrl, withBasePath } from '../site.config';
import { getMetadataValues, injectProjectMetadata, parseUserscript } from '../tools/lib/userscript';

const sample = `// ==UserScript==
// @name         Demo
// @version      1.2.3
// @description  Demo script
// @match        https://example.com/*
// @match        https://example.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @author       Someone
// @updateURL    https://old.example/demo.user.js
// ==/UserScript==
console.log('demo');
`;

describe('userscript metadata', () => {
  it('preserves multiple @match values', () => {
    const output = injectProjectMetadata(sample, 'demo-script');
    const parsed = parseUserscript(output);
    expect(getMetadataValues(parsed.entries, 'match')).toEqual([
      'https://example.com/*',
      'https://example.org/*',
    ]);
  });

  it('preserves multiple @grant values', () => {
    const output = injectProjectMetadata(sample, 'demo-script');
    const parsed = parseUserscript(output);
    expect(getMetadataValues(parsed.entries, 'grant')).toEqual(['GM_getValue', 'GM_setValue']);
  });

  it('does not duplicate project managed metadata', () => {
    const output = injectProjectMetadata(sample, 'demo-script');
    const parsed = parseUserscript(output);
    expect(getMetadataValues(parsed.entries, 'author')).toHaveLength(1);
    expect(getMetadataValues(parsed.entries, 'updateURL')).toHaveLength(1);
  });

  it('generates update and download URLs from site config', () => {
    const output = injectProjectMetadata(sample, 'demo-script');
    const parsed = parseUserscript(output);
    expect(getMetadataValues(parsed.entries, 'updateURL')).toEqual([userscriptUrl('demo-script')]);
    expect(getMetadataValues(parsed.entries, 'downloadURL')).toEqual([userscriptUrl('demo-script')]);
  });

  it('keeps BASE_PATH in public URLs', () => {
    expect(withBasePath('/userscripts/demo-script.user.js')).toBe(
      '/nwafu-scripts/userscripts/demo-script.user.js',
    );
    expect(absoluteUrl('/userscripts/demo-script.user.js')).toBe(
      'https://mjy.js.org/nwafu-scripts/userscripts/demo-script.user.js',
    );
  });
});
