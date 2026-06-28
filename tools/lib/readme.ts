import matter from 'gray-matter';
import { z } from 'zod';

export const statusSchema = z.enum(['stable', 'beta', 'paused', 'deprecated']);

export const readmeFrontmatterSchema = z.object({
  category: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  status: statusSchema,
  verified: z.preprocess(
    (value) => {
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      return value;
    },
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'verified must be an ISO date in YYYY-MM-DD format'),
  ),
  featured: z.boolean().optional().default(false),
  title_en: z.string().optional().default(''),
  summary_en: z.string().optional().default(''),
  legacy_slugs: z.array(z.string()).optional().default([]),
});

export type ReadmeFrontmatter = z.infer<typeof readmeFrontmatterSchema>;

export function parseReadme(source: string): { data: ReadmeFrontmatter; content: string } {
  const parsed = matter(source);
  const data = readmeFrontmatterSchema.parse(parsed.data);
  return { data, content: parsed.content.trim() };
}
