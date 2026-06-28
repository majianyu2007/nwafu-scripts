import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

export function removeLeadingH1(markdown: string): string {
  return markdown.replace(/^\s*#\s+.+(?:\r?\n)+/, '').trimStart();
}

export function extractHeadings(markdown: string): { depth: number; text: string; id: string }[] {
  const headings: { depth: number; text: string; id: string }[] = [];
  for (const match of markdown.matchAll(/^(#{2,3})\s+(.+)$/gm)) {
    const text = match[2].replace(/[#`*_]/g, '').trim();
    const id = text
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
    headings.push({ depth: match[1].length, text, id });
  }
  return headings;
}
