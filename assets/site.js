const root = document.documentElement;
const themeToggle = document.querySelector('[data-theme-toggle]');

function currentTheme() {
  return root.dataset.theme === 'dark' ? 'dark' : 'auto';
}

themeToggle?.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'auto' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('nwafu-theme', next);
});

document.querySelectorAll('[data-lang-switch]').forEach((link) => {
  link.addEventListener('click', () => {
    localStorage.setItem('nwafu-lang', link.getAttribute('data-lang-switch') || 'zh');
  });
});

const filterForm = document.querySelector('[data-filter-form]');
const cards = [...document.querySelectorAll('[data-script-card]')];
const empty = document.querySelector('[data-filter-empty]');

function value(name) {
  const field = filterForm?.querySelector(`[name="${name}"]`);
  return field ? field.value.trim() : '';
}

function compareText(a, b, key) {
  return (a.dataset[key] || '').localeCompare(b.dataset[key] || '', undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function compareVersionDesc(a, b) {
  const left = (a.dataset.version || '0').split('.').map((part) => Number(part) || 0);
  const right = (b.dataset.version || '0').split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] || 0) - (left[index] || 0);
    if (diff) return diff;
  }
  return compareText(a, b, 'name');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[，。、“”‘’：；（）【】]/g, ' ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function queryTokens(value) {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function cardMatchesQuery(card, tokens) {
  if (tokens.length === 0) return true;
  const strong = normalizeText(`${card.dataset.name} ${card.dataset.category} ${card.dataset.tags}`);
  const full = normalizeText(
    `${card.dataset.name} ${card.dataset.search} ${card.dataset.category} ${card.dataset.tags}`,
  );
  return tokens.every((token) => {
    if (full.includes(token)) return true;
    if (token.length === 1) return strong.includes(token);
    return false;
  });
}

function applyFilters(push = true) {
  if (!filterForm) return;
  const tokens = queryTokens(value('q'));
  const category = value('category');
  const tag = value('tag');
  const status = value('status');
  const sort = value('sort');
  let visible = 0;

  const sorted = [...cards].sort((a, b) => {
    if (sort === 'name') return compareText(a, b, 'name');
    if (sort === 'version') return compareVersionDesc(a, b);
    if (sort === 'category') return compareText(a, b, 'category') || compareText(a, b, 'name');
    return (b.dataset.verified || '').localeCompare(a.dataset.verified || '') || compareText(a, b, 'name');
  });
  const container = cards[0]?.parentElement;
  sorted.forEach((card) => container?.appendChild(card));

  for (const card of cards) {
    const ok =
      cardMatchesQuery(card, tokens) &&
      (!category || card.dataset.category === category) &&
      (!tag || (card.dataset.tags || '').split(',').includes(tag)) &&
      (!status || card.dataset.status === status);
    card.hidden = !ok;
    if (ok) visible += 1;
  }
  if (empty) empty.hidden = visible !== 0;

  if (push) {
    const params = new URLSearchParams();
    ['q', 'category', 'tag', 'status', 'sort'].forEach((key) => {
      const current = value(key);
      if (current) params.set(key, current);
    });
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
  }
}

if (filterForm) {
  const params = new URLSearchParams(location.search);
  for (const [key, current] of params) {
    const field = filterForm.querySelector(`[name="${key}"]`);
    if (field) field.value = current;
  }
  filterForm.addEventListener('input', () => applyFilters());
  filterForm.addEventListener('change', () => applyFilters());
  applyFilters(false);
}

document.querySelectorAll('pre').forEach((pre) => {
  const code = pre.querySelector('code');
  if (!code) return;
  const button = document.createElement('button');
  button.className = 'copy-code';
  button.type = 'button';
  button.textContent = 'Copy';
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(code.textContent || '');
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = 'Copy';
    }, 1200);
  });
  pre.appendChild(button);
});

document.querySelectorAll('[data-recommendations]').forEach((rootEl) => {
  const items = [...rootEl.querySelectorAll('[data-recommendation]')];
  if (items.length <= 1) return;

  function show(nextIndex) {
    items.forEach((item, itemIndex) => {
      item.hidden = itemIndex !== nextIndex;
    });
  }

  show(Math.floor(Math.random() * items.length));
});
