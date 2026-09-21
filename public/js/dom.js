/** Helpers mínimos de DOM. Sem framework: o app e pequeno o bastante. */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

const ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  check: 'M4 12.5l5 5L20 6.5',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  link: 'M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7',
  cart: 'M3 4h2l2.4 11.2a2 2 0 002 1.6h7.7a2 2 0 002-1.55L21 8H6M9 21a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3.5 2',
  lists: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13M9 7V4h6v3',
  flag: 'M12 22a10 10 0 100-20 10 10 0 000 20zm-4.5-10.2l3 3 6-6.2',
  logout: 'M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 01-2-2V6a2 2 0 012-2h6',
  copy: 'M9 9h10a1 1 0 011 1v10a1 1 0 01-1 1H9a1 1 0 01-1-1V10a1 1 0 011-1zM5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1',
  edit: 'M4 20h4L20 8a2.8 2.8 0 10-4-4L4 16v4z',
  refresh: 'M3 12a9 9 0 0115.5-6.2L21 8M21 4v4h-4M21 12a9 9 0 01-15.5 6.2L3 16M3 20v-4h4',
  plusList: 'M12 5v14M5 12h14',
  undo: 'M9 14L4 9l5-5M4 9h9a7 7 0 010 14H8',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  more: 'M12 6.01h.01M12 12.01h.01M12 18.01h.01',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12zm9.5 2.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  eyeOff: 'M10.7 6.7A7.6 7.6 0 0112 6.5c6 0 9.5 5.5 9.5 5.5a15 15 0 01-3 3.4M6.5 8A15 15 0 002.5 12s3.5 5.5 9.5 5.5c1.2 0 2.3-.2 3.3-.6M3 3l18 18M10.2 10.3a2.5 2.5 0 003.5 3.5',
};

export function icon(name, { size = 24, stroke = 2 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', stroke);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || ICONS.cart);
  if (name === 'more') path.setAttribute('stroke-width', String(stroke * 1.6));
  svg.append(path);
  return svg;
}

/* ----------------------------------------------------------- formato --- */

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const thisYear = new Date().getFullYear();
  return year === thisYear ? `${day} ${month}` : `${day} ${month} ${year}`;
}

export function formatRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `ha ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `ha ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `ha ${days} dias`;
  return formatDate(iso);
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
