import { sourceLink } from './model.mjs';

const paths = {
  home: 'M3 10 12 3l9 7v10H3z M9 20v-6h6v6',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M17 15a4 4 0 0 1 5 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M16 3a4 4 0 0 1 0 8',
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z M9 3v15 M15 6v15',
  inbox: 'M3 13 6 5h12l3 8v6H3z M3 13h6l1 3h4l1-3h6',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  refresh: 'M20 10a8 8 0 0 0-14-5L3 8 M3 3v5h5 M4 14a8 8 0 0 0 14 5l3-3 M21 21v-5h-5',
  branch: 'M6 9v6a5 5 0 0 0 5 5h4 M6 3v1 M18 9v6 M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M21 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  warning: 'M12 3 2 20h20Z M12 9v4 M12 16h.01',
  signal: 'M3 18v2 M8 14v6 M13 10v10 M18 5v15',
  globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z M2 12h20 M12 2a17 17 0 0 1 0 20 17 17 0 0 1 0-20Z',
  focus: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M3 16v5h5 M12 8v8 M8 12h8',
  book: 'M4 19V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1 0-4h13 M8 7h7 M8 11h7',
  bolt: 'M13 2 4 14h7l-1 8 10-12h-7Z',
};

export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ class: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', paths[name] ?? paths.book);
  svg.append(path);
  return svg;
}

export function el(tag, klass, ...children) {
  const node = document.createElement(tag);
  if (klass) node.className = klass;
  for (const child of children.flat(Infinity)) if (child != null) node.append(child);
  return node;
}

export function link(label, href, klass) {
  if (href?.startsWith('#')) {
    const node = el('a', klass, label);
    node.href = href;
    return node;
  }
  const allowed = sourceLink(href);
  if (!allowed) return el('span', 'muted', label);
  const node = el('a', klass, label);
  node.href = allowed;
  node.rel = 'noopener noreferrer';
  node.target = '_blank';
  return node;
}

export function button(label, action, variant = '', type = 'button') {
  const node = el('button', `button ${variant}`, label);
  node.type = type;
  if (action) node.addEventListener('click', action);
  return node;
}

export const badge = (text, tone = '') => el('span', `badge ${tone}`, text);
export const muted = text => el('p', 'muted', text);
export const actions = (...items) => el('div', 'actions', items);
export const panel = (title, inside = [], { iconName, end, tone } = {}) => el('section', `panel ${tone ?? ''}`,
  el('div', 'panel-head', el('h2', 'panel-title', iconName && icon(iconName), title), end), inside);
export const header = (title, description, controls) => el('header', 'page-head', el('h1', '', title), description && muted(description), controls);
export const rows = items => el('div', 'rows', items);
export const row = (title, meta, end) => el('div', 'row', el('div', 'row-main', title, meta && el('div', 'row-meta', meta)),
  end && el('div', 'row-side', end));
export const list = (items, empty = 'Unknown') => items?.length
  ? el('ul', 'items', items.map(item => el('li', '', item))) : muted(empty);
export const fields = entries => el('dl', 'key-values',
  entries.map(([term, detail]) => el('div', '', el('dt', '', term), el('dd', '', detail ?? 'Unknown'))));
export const short = sha => sha ? sha.slice(0, 8) : 'Unknown';

const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export function time(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Unknown';
  const node = el('time', '', formatter.format(new Date(value)));
  node.dateTime = value;
  return node;
}

export function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem('mythwrought-hq:' + key)) ?? fallback; } catch { return fallback; }
}

export function saveLocal(key, value) {
  try { localStorage.setItem('mythwrought-hq:' + key, JSON.stringify(value)); return true; } catch { return false; }
}
