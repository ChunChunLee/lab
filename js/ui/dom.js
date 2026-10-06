// 小型畫面工具：h() 建立元素，morph() 把新畫好的畫面套到舊的上面（保留捲動位置、正在輸入的文字和游標）

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPS = new Set(['value', 'checked', 'selected', 'indeterminate']);

function dispatch(e) {
  const fn = e.currentTarget.__h?.[e.type];
  if (fn) fn(e);
}

function setHandler(el, type, fn) {
  el.__h ??= {};
  if (!el.__ht?.has(type)) {
    el.addEventListener(type, dispatch, type === 'touchstart' || type === 'touchmove' ? { passive: true } : undefined);
    (el.__ht ??= new Set()).add(type);
  }
  el.__h[type] = fn;
}

function classString(c) {
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(classString).filter(Boolean).join(' ');
  return Object.entries(c).filter(([, v]) => v).map(([k]) => k).join(' ');
}

/**
 * h('div', { class, style, key, onclick, ... }, ...children)
 * - on* 是事件；value/checked 用屬性設定；html 直接放 HTML（圖示用）；key 讓清單更新時找到同一個元素
 */
export function h(tag, props, ...children) {
  const isSVG = tag === 'svg' || props?.__svg;
  const el = isSVG ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false || k === '__svg') continue;
      if (k === 'key') el.__key = String(v);
      else if (k === 'class') { const c = classString(v); if (c) el.setAttribute('class', c); }
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else el.setAttribute('style', Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== false).map(([p, x]) => `${p}:${x}`).join(';'));
      } else if (k === 'html') { el.innerHTML = v; el.__html = v; }
      else if (k.startsWith('on') && typeof v === 'function') setHandler(el, k.slice(2).toLowerCase(), v);
      else if (PROPS.has(k)) { el[k] = v; el.__props = { ...(el.__props ?? {}), [k]: v }; }
      else if (k === 'ref') el.__ref = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** 一組元素（不包外層） */
export const frag = (...children) => children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);

function sameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === 1) return a.tagName === b.tagName && (a.__key ?? null) === (b.__key ?? null);
  return true;
}

/** 把 neo 的內容套到 old 上（old 留在畫面上） */
export function morph(old, neo) {
  if (old.nodeType === 3 || old.nodeType === 8) {
    if (old.nodeValue !== neo.nodeValue) old.nodeValue = neo.nodeValue;
    return old;
  }
  // 屬性
  for (const { name } of [...old.attributes]) if (!neo.hasAttribute(name)) old.removeAttribute(name);
  for (const { name, value } of [...neo.attributes]) if (old.getAttribute(name) !== value) old.setAttribute(name, value);
  // 事件
  old.__h = {};
  for (const [type, fn] of Object.entries(neo.__h ?? {})) setHandler(old, type, fn);
  // value、checked：正在輸入的欄位不要動
  const focused = old === document.activeElement;
  for (const [k, v] of Object.entries(neo.__props ?? {})) {
    if (k === 'value' && focused) continue;
    if (old[k] !== v) old[k] = v;
  }
  old.__props = neo.__props;
  old.__ref = neo.__ref;
  if (neo.__html !== undefined || old.__html !== undefined) {
    if (old.__html !== neo.__html) { old.innerHTML = neo.__html ?? ''; old.__html = neo.__html; }
    return old;
  }
  if (old.tagName === 'TEXTAREA') return old;
  morphChildren(old, neo);
  return old;
}

/** 讓 parent 的子元素變成 neo 的子元素 */
export function morphChildren(parent, neo) {
  const newKids = [...neo.childNodes];
  const oldKids = [...parent.childNodes];
  const byKey = new Map();
  const unkeyed = [];
  for (const k of oldKids) {
    if (k.__key !== undefined) byKey.set(k.__key, k); else unkeyed.push(k);
  }
  const used = new Set();
  let u = 0;
  newKids.forEach((n, i) => {
    let match = null;
    if (n.__key !== undefined) {
      const c = byKey.get(n.__key);
      if (c && sameKind(c, n)) match = c;
    } else {
      while (u < unkeyed.length && used.has(unkeyed[u])) u++;
      const c = unkeyed[u];
      if (c && sameKind(c, n)) { match = c; u++; }
    }
    let node;
    if (match) {
      used.add(match);
      node = morph(match, n);
    } else {
      node = n;
    }
    const at = parent.childNodes[i];
    if (at !== node) parent.insertBefore(node, at ?? null);
    if (!match) runRefs(node);
  });
  for (const k of oldKids) if (!used.has(k) && k.parentNode === parent) k.remove();
  for (const k of [...parent.childNodes].slice(newKids.length)) k.remove();
}

function runRefs(node) {
  if (node.nodeType !== 1) return;
  if (node.__ref) node.__ref(node);
  for (const c of node.children) runRefs(c);
}

/** 依 render() 的結果更新 container 的內容 */
export function patch(container, ...content) {
  const neo = document.createElement('div');
  appendChildren(neo, content);
  morphChildren(container, neo);
}

/** 圖示（放 SVG 字串） */
export function icon(name, cls = '') {
  return h('span', { class: ['icon', cls], 'aria-hidden': 'true', html: ICONS[name] ?? ICONS.dot });
}

const svg = (body, fill = false) => `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  dot: svg('<circle cx="12" cy="12" r="2"/>', true),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  more: svg('<circle cx="12" cy="12" r="9.5"/><circle cx="8" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="16" cy="12" r="1" fill="currentColor"/>'),
  ellipsis: svg('<circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/>', true),
  chevronRight: svg('<path d="M9 5l7 7-7 7"/>'),
  chevronLeft: svg('<path d="M15 5l-7 7 7 7"/>'),
  chevronDown: svg('<path d="M6 9l6 6 6-6"/>'),
  chevronUp: svg('<path d="M6 15l6-6 6 6"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  checkCircle: svg('<circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/>'),
  checkCircleFill: svg('<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm5.2 7.3l-6.4 7a1 1 0 01-1.5 0l-3-3.2 1.4-1.4 2.3 2.4 5.7-6.2 1.5 1.4z"/>', true),
  xCircle: svg('<circle cx="12" cy="12" r="9.5"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>'),
  xCircleFill: svg('<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm3.5 12.1l-1.4 1.4L12 13.4l-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1z"/>', true),
  circle: svg('<circle cx="12" cy="12" r="9.5"/>'),
  plusCircle: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 8v8M8 12h8"/>'),
  minusCircleFill: svg('<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm5 11H7v-2h10v2z"/>', true),
  star: svg('<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>'),
  starFill: svg('<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>', true),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>'),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>'),
  folder: svg('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'),
  table: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M3 15h18M9 5v14"/>'),
  shuffle: svg('<path d="M16 4h4v4M20 4l-6.5 6.5M4 20l5.5-5.5M16 20h4v-4M20 20l-5-5M4 4l5 5"/>'),
  person: svg('<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0116 0"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 13.5a6.5 6.5 0 013.5 5.5"/>'),
  group: svg('<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M7 19a5 5 0 0110 0M1.5 18a4 4 0 017 -2.5M22.5 18a4 4 0 00-7-2.5"/>'),
  roster: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2.2"/><path d="M5.5 16.5a3.6 3.6 0 017 0M14 9h4M14 13h4"/>'),
  grades: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M3 15h18M9.5 4v16"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>'),
  broom: svg('<path d="M14 3l-3.5 8M7 11h8l2 9H5z M9 16v4M13 16v4"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  book: svg('<path d="M4 5.5A2.5 2.5 0 016.5 3H20v16H6.5A2.5 2.5 0 004 21.5zM4 5.5v16"/>'),
  bookFill: svg('<path d="M6.5 2A2.5 2.5 0 004 4.5v15A2.5 2.5 0 006.5 22H20V2zM6.5 18H18v2H6.5a1 1 0 010-2z"/>', true),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>'),
  download: svg('<path d="M12 3v12M8 11l4 4 4-4M5 19h14"/>'),
  upload: svg('<path d="M12 15V3M8 7l4-4 4 4M5 19h14"/>'),
  printer: svg('<path d="M7 9V3h10v6M7 18H5a2 2 0 01-2-2v-5a2 2 0 012-2h14a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>'),
  doc: svg('<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6M8 13h8M8 17h5"/>'),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  arrowUpDown: svg('<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>'),
  arrowUp: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  arrowDown: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  listNumber: svg('<path d="M10 6h11M10 12h11M10 18h11M4 4v4M3 18h3l-3 3h3"/>'),
  text: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  split: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
  undo: svg('<path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3"/>'),
  stack: svg('<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>'),
  flask: svg('<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 006 21h12a1.7 1.7 0 001.5-2.5L14 9V3"/><path d="M7 15h10"/>'),
  warning: svg('<path d="M12 3L2 20h20zM12 10v4M12 17v.5"/>'),
  info: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.5"/>'),
  keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  clipboard: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>'),
  move: svg('<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>'),
};
