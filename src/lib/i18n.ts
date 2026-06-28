export type Lang = 'zh' | 'en';

export const labels = {
  zh: {
    home: '首页',
    scripts: '脚本',
    installGuide: '安装指南',
    changelog: '更新日志',
    archive: '归档',
    about: '关于',
    install: '安装脚本',
    details: '查看说明',
    source: '查看源码',
    feedback: '反馈问题',
    back: '返回脚本列表',
    category: '分类',
    tags: '标签',
    status: '状态',
    version: '版本',
    verified: '最近验证',
    matches: '匹配规则',
    metadata: 'Userscript metadata 摘要',
    empty: '暂无可展示的稳定脚本。',
    englishNotice: '该说明暂未提供英文版本，以下显示中文文档。',
  },
  en: {
    home: 'Home',
    scripts: 'Scripts',
    installGuide: 'Install',
    changelog: 'Changelog',
    archive: 'Archive',
    about: 'About',
    install: 'Install script',
    details: 'Read notes',
    source: 'Source',
    feedback: 'Feedback',
    back: 'Back to scripts',
    category: 'Category',
    tags: 'Tags',
    status: 'Status',
    version: 'Version',
    verified: 'Verified',
    matches: 'Match rules',
    metadata: 'Userscript metadata summary',
    empty: 'No active scripts are listed yet.',
    englishNotice: 'Full English notes are not available yet. The Chinese README is shown below.',
  },
} as const;

export function displayDate(value: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00Z`));
}

export function localizedPath(path: string, lang: Lang): string {
  if (lang === 'zh') return path.replace(/^\/en(?=\/|$)/, '') || '/';
  if (path === '/') return '/en/';
  if (path.startsWith('/en/')) return path;
  return `/en${path}`;
}
