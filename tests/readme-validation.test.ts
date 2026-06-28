import { describe, expect, it } from 'vitest';
import { parseReadme } from '../tools/lib/readme';

describe('README front matter validation', () => {
  it('accepts legacy slugs', () => {
    const parsed = parseReadme(`---
category: 学生服务
tags: [上传]
status: stable
verified: 2026-06-28
legacy_slugs: [old-upload]
---
# 标题`);
    expect(parsed.data.legacy_slugs).toEqual(['old-upload']);
  });

  it('fails without required front matter', () => {
    expect(() => parseReadme('# 标题')).toThrow();
  });
});
