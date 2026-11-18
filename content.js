/*
 * ZeroSlop content script.
 *
 * UI principles used throughout this file:
 *  - Quiet by default: one small badge per post, never a page-wide banner.
 *  - Details on demand: the badge opens a popover with the reason and voting.
 *  - Account-level alerts only appear on that account's own profile, at most once per session.
 *  - Everything ZeroSlop does to the page can be undone (blurred or hidden posts can be shown).
 */

const ZS_VERSION = chrome.runtime.getManifest().version;
const ZS_REGISTRY_URL = 'https://woodrock.github.io/zero-slop';
const ZS_STATUS_URL = 'https://x.com/i/status/';
const ZS_AI_FLAG_THRESHOLD = 15; // Scores at or below this are treated as human.
const NON_PROFILE_PATHS = ['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i', 'compose', 'jobs', 'communities'];

let lastRightClickedElement = null;
let currentOverlayInfo = null;

document.addEventListener('contextmenu', (event) => {
  lastRightClickedElement = event.target;
}, true);

// ---------------------------------------------------------------------------
// Settings (cached so we don't hit storage for every post on screen)
// ---------------------------------------------------------------------------

const zsSettings = {
  communityShield: true,
  hunterVision: false,
  autoHumanDetection: false,
  autoScan: false,
  adminOrganicCollection: false,
  profileAlerts: true,
  slopAction: 'blur',
  hideThreshold: 85
};

const zsSettingsReady = new Promise((resolve) => {
  chrome.storage.local.get(Object.keys(zsSettings), (stored) => {
    for (const key of Object.keys(zsSettings)) {
      if (stored[key] !== undefined) zsSettings[key] = stored[key];
    }
    resolve();
  });
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;
  for (const key of Object.keys(zsSettings)) {
    if (changes[key]) zsSettings[key] = changes[key].newValue ?? zsSettings[key];
  }
  if (changes.autoHumanDetection && !changes.autoHumanDetection.newValue) {
    document.querySelectorAll('.zs-badge[data-kind="smart"]').forEach(b => b.remove());
  }
  if (changes.hunterVision && !changes.hunterVision.newValue) {
    document.querySelectorAll('mark.zs-mark').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  }
  if (changes.profileAlerts && !changes.profileAlerts.newValue) {
    document.querySelectorAll('.zs-toast[data-notice]').forEach(n => n.remove());
  }
});

// ---------------------------------------------------------------------------
// Styles and theme
// ---------------------------------------------------------------------------

const ZS_STYLES = `
  html {
    --zs-bg: #ffffff; --zs-fg: #0f1419; --zs-muted: #536471; --zs-border: #e6ecf0;
    --zs-surface: #f7f9f9; --zs-shadow: 0 10px 30px rgba(15, 20, 25, .16), 0 0 0 1px rgba(15, 20, 25, .06);
    --zs-red: #d91d42; --zs-amber: #a85a00; --zs-blue: #1a8cd8; --zs-green: #00845a; --zs-gray: #536471;
    --zs-accent: #1d9bf0;
    --zs-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  html[data-zs-theme="dark"] {
    --zs-bg: #16181c; --zs-fg: #e7e9ea; --zs-muted: #8b98a5; --zs-border: #2f3336;
    --zs-surface: #202327; --zs-shadow: 0 10px 30px rgba(0, 0, 0, .55), 0 0 0 1px #2f3336;
    --zs-red: #ff5c7a; --zs-amber: #ffb340; --zs-blue: #4cb3ff; --zs-green: #2fd197; --zs-gray: #8b98a5;
  }
  .zs-tone-red { --zs-tone: var(--zs-red); }
  .zs-tone-amber { --zs-tone: var(--zs-amber); }
  .zs-tone-blue { --zs-tone: var(--zs-blue); }
  .zs-tone-green { --zs-tone: var(--zs-green); }
  .zs-tone-gray { --zs-tone: var(--zs-gray); }

  /* Badge: one quiet pill next to the timestamp */
  .zs-badge {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px;
    height: 20px; padding: 0 8px; margin-left: 6px; border-radius: 999px;
    font: 600 11.5px/1 var(--zs-font); letter-spacing: .01em; white-space: nowrap; vertical-align: middle;
    color: var(--zs-tone); background: color-mix(in srgb, var(--zs-tone) 13%, transparent);
    cursor: pointer; transition: background-color .15s ease;
  }
  .zs-badge:hover { background: color-mix(in srgb, var(--zs-tone) 22%, transparent); }
  .zs-badge:focus-visible { outline: 2px solid var(--zs-tone); outline-offset: 2px; }
  .zs-badge-lg { height: 26px; padding: 0 11px; margin: 6px 0 0; font-size: 13px; }
  .zs-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }

  /* Shared surface for popover, toasts and result card */
  .zs-surface {
    box-sizing: border-box; font: 400 14px/1.4 var(--zs-font); color: var(--zs-fg);
    background: var(--zs-bg); border-radius: 14px; box-shadow: var(--zs-shadow);
  }
  .zs-surface *, .zs-surface *::before, .zs-surface *::after { box-sizing: border-box; }
  .zs-title { font-weight: 700; font-size: 15px; margin: 0; display: flex; align-items: center; gap: 8px; }
  .zs-muted { color: var(--zs-muted); font-size: 13px; }
  .zs-eyebrow { color: var(--zs-muted); font-size: 12px; font-weight: 600; letter-spacing: .02em; }
  .zs-surface a { color: var(--zs-accent); text-decoration: none; font-weight: 600; }
  .zs-surface a:hover { text-decoration: underline; }

  .zs-btn {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 34px; padding: 0 14px; border-radius: 999px; cursor: pointer;
    font: 700 13.5px/1 var(--zs-font); text-align: center; transition: filter .15s ease, background-color .15s ease;
  }
  .zs-btn:focus-visible { outline: 2px solid var(--zs-accent); outline-offset: 2px; }
  .zs-btn:disabled { opacity: .55; cursor: default; }
  .zs-btn-primary { background: var(--zs-fg); color: var(--zs-bg); }
  .zs-btn-danger { background: var(--zs-red); color: #fff; }
  .zs-btn-primary:hover:not(:disabled), .zs-btn-danger:hover:not(:disabled) { filter: brightness(1.1); }
  .zs-btn-secondary { border: 1px solid var(--zs-border); color: var(--zs-fg); }
  .zs-btn-secondary:hover:not(:disabled) { background: var(--zs-surface); }
  .zs-btn-ghost { color: var(--zs-accent); padding: 0 8px; min-height: 28px; font-weight: 600; }
  .zs-btn-ghost:hover:not(:disabled) { background: color-mix(in srgb, var(--zs-accent) 10%, transparent); }
  .zs-icon-btn {
    all: unset; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
    color: var(--zs-muted); cursor: pointer; font: 400 20px/1 var(--zs-font); flex: none;
  }
  .zs-icon-btn:hover { background: var(--zs-surface); color: var(--zs-fg); }
  .zs-icon-btn:focus-visible { outline: 2px solid var(--zs-accent); }

  /* Popover */
  .zs-popover { position: fixed; z-index: 2147483646; width: 290px; padding: 14px; animation: zsFade .12s ease-out; }
  .zs-popover .zs-desc { margin: 6px 0 0; color: var(--zs-muted); font-size: 13px; }
  .zs-popover .zs-meta { margin-top: 8px; font-size: 12px; color: var(--zs-muted); }
  .zs-popover .zs-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .zs-popover .zs-actions .zs-btn { min-height: 30px; font-size: 13px; padding: 0 12px; }
  .zs-popover .zs-footer { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--zs-border); font-size: 13px; display: flex; justify-content: space-between; gap: 8px; }

  /* Toasts */
  .zs-toasts {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483646;
    display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; width: min(420px, calc(100vw - 32px));
  }
  .zs-toast {
    pointer-events: auto; width: 100%; padding: 12px 10px 12px 16px; display: flex; align-items: flex-start; gap: 12px;
    animation: zsRise .18s ease-out; border-left: 4px solid var(--zs-tone, var(--zs-accent));
  }
  .zs-toast .zs-toast-body { flex: 1; min-width: 0; padding-top: 3px; }
  .zs-toast .zs-toast-title { font-weight: 700; }
  .zs-toast .zs-toast-text { color: var(--zs-muted); font-size: 13px; margin-top: 2px; }
  .zs-toast .zs-toast-actions { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0 -8px; }
  .zs-toast.zs-leaving { opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .2s; }

  /* Result card */
  .zs-card { position: fixed; top: 72px; right: 20px; z-index: 2147483646; width: 330px; max-height: calc(100vh - 96px); overflow-y: auto; padding: 16px; animation: zsFade .15s ease-out; }
  .zs-card-head { display: flex; align-items: center; justify-content: space-between; margin: -4px -6px 10px 0; }
  .zs-score { display: flex; align-items: baseline; gap: 10px; }
  .zs-score-num { font-size: 40px; font-weight: 800; line-height: 1; color: var(--zs-tone); font-variant-numeric: tabular-nums; }
  .zs-score-label { font-weight: 700; font-size: 15px; }
  .zs-meter { height: 6px; border-radius: 999px; background: var(--zs-surface); overflow: hidden; margin: 12px 0 6px; }
  .zs-meter > span { display: block; height: 100%; border-radius: inherit; background: var(--zs-tone); }
  .zs-stack { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
  .zs-row { display: flex; gap: 8px; }
  .zs-row > .zs-btn { flex: 1; }
  .zs-details { border: 1px solid var(--zs-border); border-radius: 12px; padding: 0 12px; }
  .zs-details[open] { padding-bottom: 12px; }
  .zs-details summary { cursor: pointer; padding: 10px 0; font-size: 13px; font-weight: 600; color: var(--zs-muted); list-style: none; }
  .zs-details summary::-webkit-details-marker { display: none; }
  .zs-details summary::after { content: "▾"; float: right; }
  .zs-details[open] summary::after { content: "▴"; }
  .zs-details summary:focus-visible { outline: 2px solid var(--zs-accent); border-radius: 4px; }
  .zs-field-label { display: block; font-size: 12px; font-weight: 700; color: var(--zs-muted); margin: 10px 0 6px; }
  .zs-select {
    width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--zs-border);
    background: var(--zs-bg); color: var(--zs-fg); font: 400 13px var(--zs-font);
  }
  .zs-hint { font-size: 12px; color: var(--zs-muted); margin-top: 6px; }
  .zs-check { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 3px 0; cursor: pointer; }
  .zs-check input { margin: 0; accent-color: var(--zs-accent); }
  .zs-confirm { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; font-weight: 600;
    color: var(--zs-green); background: color-mix(in srgb, var(--zs-green) 12%, transparent); }
  .zs-loading { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
  .zs-spinner { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--zs-border); border-top-color: var(--zs-accent); animation: zsSpin .8s linear infinite; flex: none; }

  /* Hunter Vision highlights: noticeable without shouting */
  mark.zs-mark { background: none; color: inherit; cursor: help; text-decoration-line: underline; text-underline-offset: 3px; text-decoration-thickness: 1.5px; }
  mark.zs-mark-hard { text-decoration-color: var(--zs-red); text-decoration-style: wavy; background: color-mix(in srgb, var(--zs-red) 8%, transparent); border-radius: 3px; }
  mark.zs-mark-soft { text-decoration-color: var(--zs-amber); text-decoration-style: dotted; }

  /* Blur and hide actions (both reversible) */
  .zs-veiled { position: relative; min-height: 44px; }
  .zs-veiled > :not(.zs-reveal) { filter: blur(7px); opacity: .5; pointer-events: none; user-select: none; }
  .zs-reveal {
    all: unset; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; cursor: pointer;
    font: 600 13px var(--zs-font); color: var(--zs-fg); z-index: 1;
  }
  .zs-reveal span { background: var(--zs-bg); box-shadow: var(--zs-shadow); padding: 7px 14px; border-radius: 999px; }
  .zs-reveal:focus-visible span { outline: 2px solid var(--zs-accent); }
  .zs-zapped { display: none !important; }
  .zs-zap-note {
    display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px;
    font: 400 13px var(--zs-font); color: var(--zs-muted); border-bottom: 1px solid var(--zs-border);
  }
  .zs-zap-note button { all: unset; cursor: pointer; color: var(--zs-accent); font-weight: 600; }
  .zs-zap-note button:focus-visible { outline: 2px solid var(--zs-accent); }
  .zs-zapping { animation: zsDust .6s ease-in forwards; pointer-events: none; }

  .zs-audit-btn {
    all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px; width: calc(100% - 32px);
    margin: 10px 16px; min-height: 38px; border-radius: 999px; border: 1px solid var(--zs-border); cursor: pointer;
    font: 700 14px var(--zs-font); color: var(--zs-fg);
  }
  .zs-audit-btn:hover { background: var(--zs-surface); }
  .zs-audit-btn:focus-visible { outline: 2px solid var(--zs-accent); }

  @keyframes zsFade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  @keyframes zsRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes zsSpin { to { transform: rotate(360deg); } }
  @keyframes zsDust {
    0% { opacity: 1; filter: none; transform: none; }
    100% { opacity: 0; filter: blur(12px) grayscale(1) sepia(.6); transform: translateX(40px) scale(.97); }
  }
  @media (prefers-reduced-motion: reduce) {
    .zs-popover, .zs-toast, .zs-card { animation: none; }
    .zs-zapping { animation-duration: .01s; }
    .zs-spinner { animation-duration: 2s; }
  }
`;

function injectStyles() {
  if (document.getElementById('zs-styles')) return;
  const style = document.createElement('style');
  style.id = 'zs-styles';
  style.textContent = ZS_STYLES;
  (document.head || document.documentElement).appendChild(style);
}

/** Match X's own theme (light, dim or lights out) by reading the page background. */
function syncTheme() {
  const bg = document.body ? getComputedStyle(document.body).backgroundColor : '';
  const parts = (bg.match(/[\d.]+/g) || []).map(Number);
  let dark;
  if (parts.length >= 3 && (parts.length < 4 || parts[3] > 0)) {
    dark = (0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2]) < 128;
  } else {
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  document.documentElement.dataset.zsTheme = dark ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function stop(e) {
  e.preventDefault();
  e.stopPropagation();
}

function normHandle(handle) {
  return (handle || '').replace(/^@/, '').toLowerCase();
}

function currentProfileHandle() {
  const first = window.location.pathname.split('/').filter(Boolean)[0];
  if (!first || NON_PROFILE_PATHS.includes(first.toLowerCase())) return null;
  return first.toLowerCase();
}

function isCurrentProfile(handle) {
  return !!handle && currentProfileHandle() === normHandle(handle);
}

function mapUrl(handle) {
  return `${ZS_REGISTRY_URL}?search=${encodeURIComponent(normHandle(handle))}`;
}

function statusUrl(tweetId) {
  return `${ZS_STATUS_URL}${tweetId}`;
}

function scoreTone(pct) {
  if (pct >= 70) return 'red';
  if (pct > ZS_AI_FLAG_THRESHOLD) return 'amber';
  return 'green';
}

function scoreVerdict(pct) {
  if (pct >= 70) return 'Likely AI-generated';
  if (pct >= 30) return 'Mixed signals';
  if (pct > ZS_AI_FLAG_THRESHOLD) return 'Some AI signals';
  return 'Likely human-written';
}

// ---------------------------------------------------------------------------
// Badges: one per post, the highest-priority signal wins
// ---------------------------------------------------------------------------

const BADGE_KINDS = {
  factory: {
    priority: 50, tone: 'red', label: 'Slop factory', title: 'Known slop factory',
    desc: 'The community flagged this account for mass-producing engagement-farming posts.'
  },
  highai: {
    priority: 40, tone: 'blue', label: 'High AI use', title: 'High AI usage',
    desc: 'The community flagged this account for posting lots of AI-generated content, without the bot-network tactics of a slop factory.'
  },
  score: { priority: 30, title: 'AI detection score' },
  suspicious: {
    priority: 20, tone: 'amber', label: 'Suspicious', title: 'Possible amplifier bot',
    desc: 'This account recently retweeted or quoted a confirmed slop factory.'
  },
  smart: {
    priority: 10, tone: 'amber', label: 'Slop signal', title: 'Smart Slop Guard signal',
    desc: 'The on-device model spotted patterns common in engagement farming. Nobody has verified this yet, so treat it as a hint.'
  },
  organic: {
    priority: 5, tone: 'green', label: 'Human', title: 'Verified human',
    desc: 'The community verified this account as an organic human poster.'
  }
};

const zsVotes = new Map(); // key -> 'up' | 'down', remembered for this page session

function voteActions(key, send) {
  const voted = zsVotes.get(key);
  if (voted) {
    return [{ label: voted === 'up' ? '✓ You said this looks right' : '✓ You said this looks wrong', disabled: true }];
  }
  const vote = (type) => (btn, pop) => {
    zsVotes.set(key, type);
    send(type);
    pop.querySelector('.zs-actions').replaceChildren(
      el('div', { class: 'zs-muted', role: 'status', text: 'Thanks, your vote helps everyone.' })
    );
  };
  return [
    { label: '👍 Looks right', onClick: vote('up') },
    { label: '👎 Looks wrong', onClick: vote('down') }
  ];
}

function accountVoteActions(handle) {
  return voteActions(`acct:${normHandle(handle)}`, (voteType) => {
    chrome.runtime.sendMessage({ action: 'voteAccount', handle, voteType });
  });
}

/**
 * Put (or upgrade) the ZeroSlop badge on a host element.
 * spec: { kind, label, tone, title, desc, meta, priority, replace, actions: () => [...], link: {href, text} }
 */
function setBadge(host, spec, { large = false, insert } = {}) {
  if (!host) return null;
  const base = BADGE_KINDS[spec.kind] || {};
  const full = { ...base, ...spec, priority: spec.priority ?? base.priority ?? 0 };
  const existing = host.querySelector('.zs-badge');

  if (existing) {
    const existingPriority = Number(existing.dataset.priority);
    if (existingPriority > full.priority) return existing;
    if (existingPriority === full.priority && existing.dataset.kind === full.kind && !spec.replace) return existing;
  }

  const badge = el('button', {
    type: 'button',
    class: `zs-badge zs-tone-${full.tone || 'gray'}${large ? ' zs-badge-lg' : ''}`,
    'data-kind': full.kind,
    'data-priority': full.priority,
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    'aria-label': `ZeroSlop: ${full.title || full.label}. Show details`
  }, [el('span', { class: 'zs-dot', 'aria-hidden': 'true' }), full.label]);
  badge._zsSpec = full;
  badge.addEventListener('click', (e) => { stop(e); togglePopover(badge); });
  badge.addEventListener('mousedown', (e) => e.stopPropagation());

  if (existing) {
    if (zsPopover && zsPopover._anchor === existing) closePopover();
    existing.replaceWith(badge);
  } else if (insert) {
    insert(badge);
  } else {
    const time = host.querySelector('time');
    const anchor = time ? (time.closest('a') || time) : null;
    if (anchor && host.contains(anchor)) {
      anchor.after(badge);
    } else {
      const nameRow = host.querySelector('[data-testid="User-Name"]');
      if (!nameRow) return null;
      nameRow.appendChild(badge);
    }
  }
  return badge;
}

function tweetsByHandle(handle) {
  const target = normHandle(handle);
  return Array.from(document.querySelectorAll('article')).filter((article) => {
    return normHandle(extractTweetInfo(article).author?.handle) === target;
  });
}

function setProfileHeaderBadge(kind, handle) {
  if (!isCurrentProfile(handle)) return;
  const header = document.querySelector('[data-testid="UserName"]');
  if (!header) return;
  setBadge(header, {
    kind,
    actions: () => accountVoteActions(handle),
    link: kind === 'factory' ? { href: mapUrl(handle), text: 'View network map' } : null
  }, {
    large: true,
    insert: (b) => header.appendChild(el('div', { class: 'zs-header-badge' }, [b]))
  });
}

// ---------------------------------------------------------------------------
// Popover (badge details and voting)
// ---------------------------------------------------------------------------

let zsPopover = null;

function closePopover({ restoreFocus = false } = {}) {
  if (!zsPopover) return;
  const anchor = zsPopover._anchor;
  zsPopover.remove();
  zsPopover = null;
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor && anchor.isConnected) anchor.focus();
}

function togglePopover(badge) {
  if (zsPopover && zsPopover._anchor === badge) return closePopover();
  closePopover();

  const spec = badge._zsSpec;
  const actions = typeof spec.actions === 'function' ? spec.actions() : (spec.actions || []);

  const pop = el('div', {
    class: `zs-surface zs-popover zs-tone-${spec.tone || 'gray'}`,
    role: 'dialog',
    'aria-label': spec.title || spec.label
  }, [
    el('div', { class: 'zs-eyebrow', text: 'ZeroSlop' }),
    el('p', { class: 'zs-title' }, [
      el('span', { class: 'zs-dot', style: 'color: var(--zs-tone)', 'aria-hidden': 'true' }),
      spec.title || spec.label
    ]),
    spec.desc ? el('p', { class: 'zs-desc', text: spec.desc }) : null,
    spec.meta ? el('div', { class: 'zs-meta', text: spec.meta }) : null,
    actions.length ? el('div', { class: 'zs-actions' }, actions.map((a) => el('button', {
      type: 'button',
      class: `zs-btn zs-btn-${a.variant || 'secondary'}`,
      disabled: a.disabled,
      onclick: (e) => { stop(e); a.onClick?.(e.currentTarget, pop); }
    }, a.label))) : null,
    el('div', { class: 'zs-footer' }, [
      spec.link
        ? el('a', { href: spec.link.href, target: '_blank', rel: 'noopener', text: spec.link.text })
        : el('span', { class: 'zs-muted', text: 'Votes improve the registry' }),
      el('a', { href: ZS_REGISTRY_URL, target: '_blank', rel: 'noopener', text: 'Registry ↗' })
    ])
  ]);
  pop._anchor = badge;
  ['click', 'mousedown', 'pointerdown'].forEach((t) => pop.addEventListener(t, (e) => e.stopPropagation()));

  document.body.appendChild(pop);
  const rect = badge.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let top = rect.bottom + 8;
  if (top + popRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - popRect.height - 8);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - popRect.width - 8);
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;

  badge.setAttribute('aria-expanded', 'true');
  zsPopover = pop;
  (pop.querySelector('button:not([disabled])') || pop.querySelector('a'))?.focus({ preventScroll: true });
}

document.addEventListener('pointerdown', (e) => {
  if (zsPopover && !zsPopover.contains(e.target) && !zsPopover._anchor.contains(e.target)) closePopover();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (zsPopover) { closePopover({ restoreFocus: true }); return; }
  document.getElementById('zs-result-card')?.remove();
});
window.addEventListener('scroll', (e) => {
  if (zsPopover && !zsPopover.contains(e.target)) closePopover();
}, { passive: true, capture: true });
window.addEventListener('resize', () => closePopover());

// ---------------------------------------------------------------------------
// Toasts (bottom centre, like X's own) and profile notices
// ---------------------------------------------------------------------------

function toastHost() {
  let host = document.getElementById('zs-toasts');
  if (!host) {
    host = el('div', { id: 'zs-toasts', class: 'zs-toasts', role: 'region', 'aria-label': 'ZeroSlop notifications', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  return host;
}

function dismissToast(toast) {
  if (!toast || !toast.isConnected || toast.classList.contains('zs-leaving')) return;
  toast.classList.add('zs-leaving');
  setTimeout(() => toast.remove(), 200);
}

/**
 * Show a short, non-blocking message.
 * opts: { title, tone, timeout (ms, 0 = stays until dismissed), actions: [{label, onClick}], key, notice, onDismiss }
 */
function zsToast(text, opts = {}) {
  const host = toastHost();
  const key = opts.key || `${opts.title || ''}|${text}`;
  host.querySelectorAll('.zs-toast').forEach((t) => { if (t.dataset.key === key) t.remove(); });

  const toast = el('div', {
    class: `zs-surface zs-toast zs-tone-${opts.tone || 'blue'}`,
    'data-notice': opts.notice ? 'true' : null,
    role: 'status'
  });
  toast.dataset.key = key;

  const body = el('div', { class: 'zs-toast-body' }, [
    opts.title ? el('div', { class: 'zs-toast-title', text: opts.title }) : null,
    text ? el('div', { class: opts.title ? 'zs-toast-text' : '', text }) : null
  ]);
  if (opts.actions?.length) {
    body.appendChild(el('div', { class: 'zs-toast-actions' }, opts.actions.map((a) => el('button', {
      type: 'button',
      class: 'zs-btn zs-btn-ghost',
      onclick: (e) => { a.onClick?.(e.currentTarget, toast); if (a.dismiss !== false) dismissToast(toast); }
    }, a.label))));
  }
  toast.append(body, el('button', {
    type: 'button', class: 'zs-icon-btn', 'aria-label': 'Dismiss',
    onclick: () => { opts.onDismiss?.(); dismissToast(toast); }
  }, '×'));

  host.appendChild(toast);
  // Keep the stack short so it never takes over the screen.
  const live = host.querySelectorAll('.zs-toast:not(.zs-leaving)');
  if (live.length > 3) dismissToast(live[0]);

  const timeout = opts.timeout ?? 4000;
  if (timeout > 0) {
    let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => dismissToast(toast), timeout); };
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('focusin', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', arm);
    arm();
  }
  return toast;
}

const NOTICE_PRIORITY = { factory: 50, highai: 40, profile: 30, suspicious: 20 };
const shownNotices = new Map(); // handle -> priority of the notice shown on this page

function noticeDismissKey(handle) {
  return `zs-notice-dismissed:${normHandle(handle)}`;
}

/**
 * Account warnings only appear on that account's own profile, at most once per tab session,
 * and only the most important one. Scrolling the timeline never triggers them.
 */
function showProfileNotice(kind, handle, { title, text, actions = [] }) {
  if (!zsSettings.profileAlerts || !isCurrentProfile(handle)) return;
  try { if (sessionStorage.getItem(noticeDismissKey(handle))) return; } catch (e) {}
  const priority = NOTICE_PRIORITY[kind] || 0;
  if ((shownNotices.get(normHandle(handle)) || 0) >= priority) return;
  shownNotices.set(normHandle(handle), priority);

  const remember = () => { try { sessionStorage.setItem(noticeDismissKey(handle), '1'); } catch (e) {} };
  zsToast(text, {
    title,
    tone: kind === 'profile' ? 'red' : (BADGE_KINDS[kind]?.tone || 'red'),
    key: `notice:${normHandle(handle)}`,
    notice: true,
    timeout: 10000,
    onDismiss: remember,
    actions
  });
}

function clearPageUi() {
  closePopover();
  document.querySelectorAll('.zs-toast[data-notice]').forEach((n) => n.remove());
  document.querySelectorAll('.zs-header-badge').forEach((b) => b.remove());
  shownNotices.clear();
}

// ---------------------------------------------------------------------------
// Account status (registry lookups answered by the background script)
// ---------------------------------------------------------------------------

function applyAccountStatus(kind, handle, extra = {}) {
  if (!handle) return;

  tweetsByHandle(handle).forEach((article) => {
    let spec = { kind, actions: () => accountVoteActions(handle) };
    if (kind === 'factory') spec.link = { href: mapUrl(handle), text: 'View network map' };
    if (kind === 'suspicious') {
      spec = { kind, link: extra.reasonTweetId ? { href: statusUrl(extra.reasonTweetId), text: 'See what it amplified' } : null };
    }
    setBadge(article, spec);
    if (kind === 'factory') handleAutoAction(article, 100, 'Slop factory');
  });

  if (kind !== 'suspicious') setProfileHeaderBadge(kind, handle);

  const at = `@${normHandle(handle)}`;
  if (kind === 'factory') {
    showProfileNotice('factory', handle, {
      title: `${at} is a known slop factory`,
      text: 'The community flagged this account for mass-producing engagement bait.',
      actions: [{ label: 'View network map', onClick: () => window.open(mapUrl(handle), '_blank', 'noopener') }]
    });
  } else if (kind === 'highai') {
    showProfileNotice('highai', handle, {
      title: `${at} posts a lot of AI content`,
      text: 'The community flagged this account for high AI usage.'
    });
  } else if (kind === 'suspicious') {
    showProfileNotice('suspicious', handle, {
      title: `${at} may be an amplifier bot`,
      text: 'It recently retweeted or quoted a confirmed slop factory.',
      actions: extra.reasonTweetId
        ? [{ label: 'See the post', onClick: () => window.open(statusUrl(extra.reasonTweetId), '_blank', 'noopener') }]
        : []
    });
  }
  // Verified humans only get a quiet green badge. Good news doesn't need an alert.
}

function showProfileSlopWarning(handle, highSlopCount, avgScore) {
  showProfileNotice('profile', handle, {
    title: `${highSlopCount} AI-heavy posts from @${normHandle(handle)}`,
    text: `Scanned posts from this account average ${avgScore}% AI.`,
    actions: [{
      label: 'Report as slop factory',
      onClick: () => {
        const info = extractProfileInfo(null);
        if (info?.author?.handle) {
          chrome.runtime.sendMessage({ action: 'manualReportAccount', author: info.author });
          zsToast(`Thanks. ${info.author.handle} was reported as a slop factory.`, { tone: 'green' });
        }
      }
    }]
  });
}

// ---------------------------------------------------------------------------
// Messages from the background script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getTweetText':
      sendResponse(extractTweetInfo(lastRightClickedElement));
      break;
    case 'getThreadText':
      sendResponse(extractThreadInfo(lastRightClickedElement));
      break;
    case 'getProfileText':
      sendResponse(extractProfileInfo(lastRightClickedElement));
      break;
    case 'showLoader':
      showResultCard({ state: 'loading' });
      break;
    case 'showResult':
      handleResult(request);
      break;
    case 'adminShowBadge':
      handleAdminBadge(request.data);
      break;
    case 'showError':
      showResultCard({ state: 'error', message: request.message });
      break;
    case 'showProfileWarning':
      showProfileSlopWarning(request.handle, request.highSlopCount, request.avgScore);
      break;
    case 'showSuspiciousWarning':
      applyAccountStatus('suspicious', request.handle, { reasonTweetId: request.reasonTweetId });
      break;
    case 'showSlopFactoryWarning':
      applyAccountStatus('factory', request.handle);
      break;
    case 'showHighAIWarning':
      applyAccountStatus('highai', request.handle);
      break;
    case 'showOrganicSuccess':
      applyAccountStatus('organic', request.handle);
      break;
  }
  return true;
});

function handleResult(request) {
  const data = request.data || {};
  const hasScore = data.fakePercentage !== undefined && data.fakePercentage !== null;
  const pct = Math.round(Number(data.fakePercentage) || 0);
  const message = data.feedback_message || '';
  const isThreadScan = message.startsWith('Thread Analysis');

  if (!request.isAutoScan) {
    if (!hasScore) {
      // Confirmation only, e.g. "Reported to ZeroSlop Registry".
      document.getElementById('zs-result-card')?.remove();
      zsToast(message || 'Done', { tone: 'green' });
      return;
    }
    const scope = isThreadScan ? (request.tweetId ? 'thread' : 'profile') : (request.tweetId ? 'tweet' : 'selection');
    currentOverlayInfo = scope === 'profile' ? extractProfileInfo(lastRightClickedElement)
      : scope === 'thread' ? extractThreadInfo(lastRightClickedElement)
      : extractTweetInfo(lastRightClickedElement);
    showResultCard({ state: 'result', pct, words: data.textWords, scope, info: currentOverlayInfo });
    // A thread, profile or text-selection score doesn't belong on a single post.
    if (scope !== 'tweet') return;
  }

  const container = request.tweetId ? getTweetContainerByTweetId(request.tweetId) : null;
  injectScoreBadge(container, pct, {
    upvotes: data.upvotes || 0,
    downvotes: data.downvotes || 0,
    tweetId: request.tweetId,
    // Automatic lookups only badge posts worth flagging. A post you scanned yourself always gets one.
    force: !request.isAutoScan
  });
}

function injectScoreBadge(container, pct, { upvotes = 0, downvotes = 0, tweetId, force = false } = {}) {
  if (!container) return;
  if (!force && pct <= ZS_AI_FLAG_THRESHOLD) return;
  if (!force && downvotes > upvotes + 2) return; // The community disagrees with this score.

  const id = tweetId || extractTweetInfo(container).tweetId;
  const total = upvotes + downvotes;
  setBadge(container, {
    kind: 'score',
    replace: force,
    tone: scoreTone(pct),
    label: `${pct}% AI`,
    title: `${pct}% AI · ${scoreVerdict(pct)}`,
    desc: 'ZeroGPT’s estimate of how much of this post was machine-written.',
    meta: total ? `Community: ${upvotes} agree · ${downvotes} disagree` : 'No community votes yet',
    actions: () => voteActions(`tweet:${id}`, (voteType) => {
      if (id && !String(id).startsWith('local-')) chrome.runtime.sendMessage({ action: 'voteSlop', voteType, tweetId: id });
    })
  });
  handleAutoAction(container, pct, `${pct}% AI`);
}

// Developer data-collection mode: label posts so they can be added to the training dataset.
function handleAdminBadge({ percentage, tweetId, author }) {
  const container = getTweetContainerByTweetId(tweetId);
  if (!container) return;

  const text = () => container.querySelector('[data-testid="tweetText"]')?.innerText || '';
  const done = (pop, message) => pop.querySelector('.zs-actions').replaceChildren(el('div', { class: 'zs-muted', role: 'status', text: message }));
  const skip = { label: 'Skip', onClick: () => { closePopover(); container.querySelector('.zs-badge[data-kind="admin"]')?.remove(); } };

  const showBadge = (isSlopFactory) => {
    if (isSlopFactory) {
      setBadge(container, {
        kind: 'admin', priority: 60, tone: 'red', label: `Factory post · ${percentage}%`, title: 'Post from a known slop factory',
        desc: 'Add this post to the slop registry?',
        actions: [{ label: 'Add to registry', variant: 'primary', onClick: (btn, pop) => {
          chrome.runtime.sendMessage({ action: 'manualReport', tweetId, text: text(), aiScore: percentage, author, slopType: 'type_slop_factory', shieldType: 'shield-red' });
          done(pop, 'Added to the slop registry.');
        } }, skip]
      });
    } else if (percentage <= ZS_AI_FLAG_THRESHOLD) {
      setBadge(container, {
        kind: 'admin', priority: 60, tone: 'green', label: `Human · ${percentage}%`, title: 'Likely human-written',
        desc: 'Add this post to the human dataset?',
        actions: [{ label: 'Add to dataset', variant: 'primary', onClick: (btn, pop) => {
          chrome.runtime.sendMessage({ action: 'voteHuman', voteType: 'up', tweetId, text: text(), author });
          done(pop, 'Added to the human dataset.');
        } }, skip]
      });
    } else {
      setBadge(container, {
        kind: 'admin', priority: 60, tone: scoreTone(percentage), label: `Likely AI · ${percentage}%`, title: 'Likely AI-generated',
        desc: 'This post scored above the human threshold.'
      });
    }
  };

  if (author?.handle) {
    chrome.runtime.sendMessage({ action: 'checkSlopAccount', handle: author.handle }, (result) => {
      showBadge(!!result && (result.shield_type === 'red' || result.shield_type === 'blue'));
    });
  } else {
    showBadge(false);
  }
}

// ---------------------------------------------------------------------------
// Hunter Vision: underline engagement-bait phrases in place
// ---------------------------------------------------------------------------

function findRuleMatches(text) {
  const ranges = [];
  for (const rule of UNIFIED_SLOP_RULES) {
    const flags = rule.regex.flags.includes('g') ? rule.regex.flags : `${rule.regex.flags}g`;
    const re = new RegExp(rule.regex.source, flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      ranges.push({ start: m.index, end: m.index + m[0].length, rule });
    }
  }
  // Prefer short, specific hooks ("7 prompts") over long clause matches, then stronger rules.
  ranges.sort((a, b) => (a.end - a.start) - (b.end - b.start) || b.rule.points - a.rule.points);
  const kept = [];
  for (const r of ranges) {
    if (!kept.some((k) => r.start < k.end && k.start < r.end)) kept.push(r);
  }
  return kept.sort((a, b) => a.start - b.start);
}

function highlightSlopMarkers(article) {
  if (!zsSettings.hunterVision || !article) return;
  const root = article.querySelector('[data-testid="tweetText"]');
  if (!root || root.dataset.zsHighlighted) return;
  root.dataset.zsHighlighted = 'true';

  // Walk text nodes so links, mentions and emoji images are left intact.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const text = node.nodeValue;
    const matches = findRuleMatches(text);
    if (!matches.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const { start, end, rule } of matches) {
      if (start > pos) frag.append(text.slice(pos, start));
      frag.append(el('mark', {
        class: `zs-mark ${rule.points >= 5 ? 'zs-mark-hard' : 'zs-mark-soft'}`,
        title: `ZeroSlop · ${rule.label}: ${rule.description}`
      }, text.slice(start, end)));
      pos = end;
    }
    if (pos < text.length) frag.append(text.slice(pos));
    node.replaceWith(frag);
  }
}

// ---------------------------------------------------------------------------
// Blur / hide actions (always reversible)
// ---------------------------------------------------------------------------

function handleAutoAction(container, percentage, reason) {
  if (!container) return;
  const action = zsSettings.slopAction || 'blur';
  const threshold = zsSettings.hideThreshold ?? 85;
  if (action === 'none' || percentage < threshold) return;
  if (container.dataset.zsActioned || container.dataset.zsRevealed) return;
  container.dataset.zsActioned = action;
  if (action === 'zap') zapPost(container, reason);
  else veilPost(container, reason);
}

function veilPost(container, reason) {
  const content = container.querySelector('[data-testid="tweetText"]')?.parentElement;
  if (!content || content.classList.contains('zs-veiled')) return;
  content.classList.add('zs-veiled');
  const reveal = el('button', {
    type: 'button',
    class: 'zs-reveal',
    'aria-label': `Hidden by ZeroSlop: ${reason}. Show post`
  }, [el('span', { text: `Hidden · ${reason} · Show` })]);
  reveal.addEventListener('mousedown', (e) => e.stopPropagation());
  reveal.addEventListener('click', (e) => {
    stop(e);
    content.classList.remove('zs-veiled');
    reveal.remove();
    container.dataset.zsRevealed = 'true';
  });
  content.appendChild(reveal);
}

function zapPost(container, reason) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  container.classList.add('zs-zapping');
  setTimeout(() => {
    container.classList.remove('zs-zapping');
    container.classList.add('zs-zapped');
    const show = el('button', { type: 'button', text: 'Show' });
    const note = el('div', { class: 'zs-zap-note', role: 'note' }, [
      el('span', { text: `Post hidden by ZeroSlop · ${reason}` }),
      show
    ]);
    note.addEventListener('click', (e) => e.stopPropagation());
    show.addEventListener('click', (e) => {
      stop(e);
      container.classList.remove('zs-zapped');
      container.dataset.zsRevealed = 'true';
      note.remove();
    });
    container.before(note);
  }, reduceMotion ? 0 : 600);
}

// ---------------------------------------------------------------------------
// Observers: scan posts as they scroll into view
// ---------------------------------------------------------------------------

function scanArticle(container) {
  highlightSlopMarkers(container);
  const info = extractTweetInfo(container);

  // Layer 3: Smart Slop Guard (on-device model)
  if (zsSettings.autoHumanDetection && info.text && info.text.length > 20) {
    const prediction = ZeroSlopClassifier.predict(info.text);
    if (prediction && (prediction.label === 'slop-factory' || prediction.label === 'ai-generated') && prediction.probability > 0.70) {
      setBadge(container, {
        kind: 'smart',
        meta: `Model confidence: ${Math.round(prediction.probability * 100)}%`
      });
    }
  }

  if (!info.tweetId || info.tweetId.startsWith('local-')) return;
  container.setAttribute('data-zerogpt-tweet-id', info.tweetId);

  // Layer 1: Community Shield (registry lookup, on by default)
  if (zsSettings.communityShield !== false) {
    chrome.runtime.sendMessage({ action: 'checkRegistry', tweetId: info.tweetId });
  }

  // Layer 4: ZeroGPT auto-scan (paid, opt-in)
  if (zsSettings.autoScan || zsSettings.adminOrganicCollection) {
    chrome.runtime.sendMessage({ action: 'autoScanTweet', text: info.text, tweetId: info.tweetId, author: info.author });
  }

  if (info.author?.handle) {
    chrome.runtime.sendMessage({ action: 'checkSuspicious', handle: info.author.handle });
    chrome.runtime.sendMessage({ action: 'checkSlopAccount', handle: info.author.handle });
  }
}

function scanUserCell(container) {
  const handleEl = container.querySelector('span:nth-child(2)');
  if (handleEl && handleEl.innerText.startsWith('@')) {
    chrome.runtime.sendMessage({ action: 'checkSlopAccount', handle: handleEl.innerText });
    chrome.runtime.sendMessage({ action: 'checkSuspicious', handle: handleEl.innerText });
  }
}

async function initObservers() {
  if (window.zerogptObserver) window.zerogptObserver.disconnect();

  await zsSettingsReady;
  await ZeroSlopClassifier.load();

  const checkContext = () => {
    syncTheme();
    const handle = currentProfileHandle();
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (handle && parts.length === 1) {
      chrome.runtime.sendMessage({ action: 'checkProfileSlop', handle: `@${handle}` });
      chrome.runtime.sendMessage({ action: 'checkSuspicious', handle: `@${handle}` });
      chrome.runtime.sendMessage({ action: 'checkSlopAccount', handle: `@${handle}` });
    }
    const path = window.location.pathname;
    if (path.includes('/following') || path.includes('/followers') || path.includes('/verified_followers')) {
      injectListAuditorButton();
    }
  };

  checkContext();

  let lastPath = window.location.pathname;
  const navObserver = new MutationObserver(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      clearPageUi();
      document.getElementById('zerogpt-list-auditor')?.remove();
      checkContext();
    }
  });
  navObserver.observe(document.head, { childList: true, subtree: true });

  // Re-check the theme when X switches between light, dim and lights out.
  new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });

  window.zerogptObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const container = entry.target;
      if (container.dataset.zerogptChecked) return;
      container.dataset.zerogptChecked = 'true';
      if (container.tagName === 'ARTICLE') scanArticle(container);
      else if (container.getAttribute('data-testid') === 'UserCell') scanUserCell(container);
    });
  }, { threshold: 0.1 });

  const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.tagName === 'ARTICLE' || node.getAttribute('data-testid') === 'UserCell') {
          window.zerogptObserver.observe(node);
        } else {
          node.querySelectorAll('article, [data-testid="UserCell"]').forEach((t) => window.zerogptObserver.observe(t));
        }
      });
    });
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });

  const retweetObserver = new MutationObserver(() => {
    const path = window.location.pathname;
    if (!path.includes('/retweets') && !path.includes('/quotes')) return;
    const match = path.match(/\/status\/(\d+)/);
    if (!match) return;
    const tweetId = match[1];
    chrome.runtime.sendMessage({ action: 'checkRegistry', tweetId }, (data) => {
      if (!data || data.ai_score <= ZS_AI_FLAG_THRESHOLD) return;
      document.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
        const handleEl = cell.querySelector('span:nth-child(2)');
        if (handleEl && handleEl.innerText.startsWith('@')) {
          chrome.runtime.sendMessage({
            action: 'reportSuspicious',
            handle: handleEl.innerText,
            name: cell.querySelector('span:nth-child(1)')?.innerText,
            pfp: cell.querySelector('img')?.src,
            tweetId,
            factoryHandle: data.author_handle
          });
        }
      });
    });
  });
  retweetObserver.observe(document.body, { childList: true, subtree: true });

  document.querySelectorAll('article, [data-testid="UserCell"]').forEach((node) => window.zerogptObserver.observe(node));
}

function injectListAuditorButton() {
  if (document.getElementById('zerogpt-list-auditor')) return;
  const column = document.querySelector('[data-testid="primaryColumn"]');
  if (!column) return;

  const btn = el('button', { type: 'button', id: 'zerogpt-list-auditor', class: 'zs-audit-btn' }, '🕵️ Audit this list in the ZeroSlop registry');
  btn.addEventListener('click', () => {
    const handles = Array.from(document.querySelectorAll('[data-testid="UserCell"] span:nth-child(2)'))
      .map((node) => node.innerText)
      .filter((h) => h.startsWith('@'));
    if (handles.length === 0) {
      zsToast('No accounts loaded yet. Scroll down a little, then try again.', { tone: 'amber' });
      return;
    }
    window.open(`${ZS_REGISTRY_URL}?audit=${encodeURIComponent(handles.join(','))}`, '_blank', 'noopener');
  });
  column.prepend(btn);
}

function getTweetContainer(element) {
  if (!element) return null;
  let container = element.closest('article');
  if (!container) container = element.closest('[data-testid="cellInnerDiv"]');
  if (!container) container = element.closest('[data-testid="tweet"]');
  return container;
}

function getTweetContainerByTweetId(tweetId) {
  if (!tweetId) return null;
  return document.querySelector(`article[data-zerogpt-tweet-id="${tweetId}"]`) ||
         document.querySelector(`article a[href*="/status/${tweetId}"]`)?.closest('article') ||
         document.querySelector(`[data-zerogpt-id="${tweetId}"]`);
}

function extractTweetInfo(element) {
  const container = getTweetContainer(element);
  let text = "";
  let tweetId = "local-" + Date.now();
  let author = { name: "Unknown", handle: "@anonymous", pfp: "" };
  
  if (container) {
    const tweetTextDiv = container.querySelector('[data-testid="tweetText"]');
    if (tweetTextDiv) {
      text = tweetTextDiv.innerText || tweetTextDiv.textContent || "";
    }

    const timeLink = container.querySelector('time')?.parentElement;
    if (timeLink && timeLink.href) {
      const match = timeLink.href.match(/\/status\/(\d+)/);
      if (match) tweetId = match[1];
    }

    const userNameDiv = container.querySelector('[data-testid="User-Name"]');
    if (userNameDiv) {
      const nameEl = userNameDiv.querySelector('span');
      if (nameEl) author.name = nameEl.innerText;
      
      const links = userNameDiv.querySelectorAll('a');
      for (const link of links) {
        if (link.innerText && link.innerText.startsWith('@')) {
          author.handle = link.innerText;
          break;
        }
      }
    }

    const pfpEl = container.querySelector('[data-testid="Tweet-User-Avatar"] img') || 
                  container.querySelector('img[src*="profile_images"]');
    if (pfpEl) author.pfp = pfpEl.src;

    return { text, tweetId, author };
  }

  // Fallback for non-container elements
  const nearbyText = element ? element.closest('[data-testid="tweetText"]') : null;
  if (nearbyText) {
    text = nearbyText.innerText || nearbyText.textContent || "";
  }
  return { text, tweetId, author };
}

function extractThreadInfo(element) {
  const currentTweetInfo = extractTweetInfo(element);
  if (!currentTweetInfo.author?.handle) return currentTweetInfo;

  const targetHandle = currentTweetInfo.author.handle;
  const articles = document.querySelectorAll('article');
  let combinedText = "";
  let count = 0;

  articles.forEach(article => {
    const userNameDiv = article.querySelector('[data-testid="User-Name"]');
    if (userNameDiv) {
      const handleLink = Array.from(userNameDiv.querySelectorAll('a')).find(a => a.innerText === targetHandle);
      if (handleLink) {
        const textDiv = article.querySelector('[data-testid="tweetText"]');
        if (textDiv) {
          combinedText += (textDiv.innerText || textDiv.textContent) + "\n\n";
          count++;
        }
      }
    }
  });

  return {
    ...currentTweetInfo,
    text: combinedText.trim(),
    isThread: true,
    tweetCount: count
  };
}

function extractProfileInfo(element) {
  const currentTweetInfo = extractTweetInfo(element);
  let targetHandle = currentTweetInfo.author?.handle;

  if (!targetHandle) {
    const pathParts = window.location.pathname.split('/');
    if (pathParts.length >= 2 && !['home', 'explore', 'notifications', 'messages', 'search', 'settings'].includes(pathParts[1])) {
      targetHandle = '@' + pathParts[1];
    }
  }

  if (!targetHandle) return currentTweetInfo;

  const articles = document.querySelectorAll('article');
  let combinedText = "";
  let count = 0;

  articles.forEach(article => {
    const userNameDiv = article.querySelector('[data-testid="User-Name"]');
    if (userNameDiv) {
      const handleLink = Array.from(userNameDiv.querySelectorAll('a')).find(a => a.innerText.toLowerCase() === targetHandle.toLowerCase());
      if (handleLink) {
        const textDiv = article.querySelector('[data-testid="tweetText"]');
        if (textDiv) {
          combinedText += (textDiv.innerText || textDiv.textContent) + "\n\n";
          count++;
        }
      }
    }
  });

  return {
    ...currentTweetInfo,
    text: combinedText.trim(),
    isThread: true,
    tweetCount: count,
    author: { ... (currentTweetInfo.author || {}), handle: targetHandle }
  };
}

function autoScanAmplifiers() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('zerogpt_scan') === 'true') {
    console.log("ZeroSlop: Bounty Hunter active. Scanning bot network...");
    
    let scanCount = 0;
    const scanInterval = setInterval(() => {
      const userCells = document.querySelectorAll('[data-testid="UserCell"]');
      if (userCells.length > 0 || scanCount > 15) {
        clearInterval(scanInterval);
        
        const match = window.location.pathname.match(/\/status\/(\d+)/);
        const tweetId = match ? match[1] : null;

        // Try to get handle from the page if possible (e.g. from the tweet being retweeted)
        let foundFactoryHandle = null;
        const authorEl = document.querySelector('[data-testid="User-Name"] a');
        if (authorEl && authorEl.innerText.startsWith('@')) {
          foundFactoryHandle = authorEl.innerText;
        }

        chrome.runtime.sendMessage({ action: "checkRegistry", tweetId: tweetId }, (regData) => {
          const factoryHandle = foundFactoryHandle || regData?.author_handle;

          userCells.forEach(cell => {
            const spans = cell.querySelectorAll('span');
            let handle = null;
            let name = null;
            
            // Twitter's UserCell usually has name in 1st/2nd span and handle in another
            spans.forEach(s => {
              if (s.innerText.startsWith('@')) handle = s.innerText;
            });

            if (handle) {
              const pfpEl = cell.querySelector('img');
              chrome.runtime.sendMessage({
                action: "reportSuspicious",
                handle: handle,
                name: name || handle,
                pfp: pfpEl?.src,
                tweetId: tweetId,
                factoryHandle: factoryHandle
              });
            }
          });
        });
        
        console.log(`ZeroSlop: Scanned ${userCells.length} potential bots. Mission complete.`);
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: "closeScanTab" });
        }, 1500);
      }
      scanCount++;
    }, 1000);
  }
}

async function generateWantedPoster(author, percentage) {
  if (!author) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 600;
  canvas.height = 800;
  ctx.fillStyle = '#f4e4bc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = 20;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  ctx.fillStyle = '#5d4037';
  ctx.font = 'bold 80px "Courier New", Courier, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('WANTED', canvas.width / 2, 120);
  ctx.font = 'bold 30px "Courier New", Courier, monospace';
  ctx.fillText('FOR SPREADING AI SLOP', canvas.width / 2, 160);
  if (author.pfp) {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = author.pfp;
      await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
      ctx.fillStyle = '#d7ccc8';
      ctx.fillRect(150, 200, 300, 300);
      ctx.drawImage(img, 150, 200, 300, 300);
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 5;
      ctx.strokeRect(150, 200, 300, 300);
    } catch (e) {}
  }
  ctx.fillStyle = '#5d4037';
  ctx.font = 'bold 40px "Courier New", Courier, monospace';
  ctx.fillText(author.name || 'Unknown Slop-Poster', canvas.width / 2, 560);
  ctx.font = 'italic 30px "Courier New", Courier, monospace';
  ctx.fillText(author.handle || '@anonymous', canvas.width / 2, 610);
  ctx.save();
  ctx.translate(canvas.width / 2, 400);
  ctx.rotate(-0.3);
  ctx.strokeStyle = 'rgba(244, 33, 46, 0.8)';
  ctx.lineWidth = 15;
  ctx.strokeRect(-250, -60, 500, 120);
  ctx.fillStyle = 'rgba(244, 33, 46, 0.8)';
  ctx.font = 'bold 70px Arial';
  ctx.fillText('AI SLOP', 0, 15);
  ctx.font = 'bold 30px Arial';
  ctx.fillText(`DETECTED: ${percentage}%`, 0, 45);
  ctx.restore();
  ctx.fillStyle = '#5d4037';
  ctx.font = 'bold 20px Arial';
  ctx.fillText('stamped by github.com/woodrock/zero-slop', canvas.width / 2, 750);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not render the poster'));
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(resolve, reject);
    });
  });
}

const SLOP_TYPES = [
  { 
    id: 'type_psych_burnout', 
    name: 'Burnout Exploit ($10k/mo)', 
    emoji: '🔥',
    description: 'Targets your exhaustion by selling a "magic button" solution to your problems.'
  },
  { 
    id: 'type_psych_imposter', 
    name: 'Imposter Panacea (No Skill)', 
    emoji: '🎓',
    description: 'Lowers the barrier to entry to make complex success seem easy for anyone.'
  },
  { 
    id: 'type_psych_paranoia', 
    name: 'Peer Paranoia (Get Ahead)', 
    emoji: '🕵️',
    description: 'Weaponizes the fear that your peers are getting ahead of you.'
  },
  { 
    id: 'type_psych_guilt', 
    name: 'Execution Guilt (7 Prompts)', 
    emoji: '✍️',
    description: 'Makes you feel like your lack of progress is just due to missing a "secret" prompt.'
  },
  { 
    id: 'type_algo_overload', 
    name: 'Cognitive Overload (20 Tools)', 
    emoji: '🧠',
    description: 'Overwhelms you with massive data dumps to force a "Save/Bookmark" action.'
  },
  { 
    id: 'type_algo_consensus', 
    name: 'Manufactured Consensus (Reply GPT)', 
    emoji: '🤖',
    description: 'Demands a specific keyword comment to trick the algorithm into seeing organic engagement.'
  },
  { 
    id: 'type_algo_curiosity', 
    name: 'Curiosity Gap (Show More)', 
    emoji: '🕳️',
    description: 'Hides the payload behind a "Show more" button to artificially increase dwell time.'
  },
  { 
    id: 'type_struct_math', 
    name: 'Math-Washing (Tool+Time=$)', 
    emoji: '🧮',
    description: 'Uses absurd, oversimplified equations to bypass your logical skepticism.'
  },
  { 
    id: 'type_struct_launder', 
    name: 'Institutional Launder (Harvard)', 
    emoji: '🏛️',
    description: 'Borrows the credibility of elite institutions to make generic tools seem high-end.'
  },
  { 
    id: 'type_struct_beta', 
    name: 'Beta-Tester Loophole', 
    emoji: '🧪',
    description: 'Uses "in testing" claims to brag about fake profits without making legal guarantees.'
  },
  { 
    id: 'type_visual_hijack', 
    name: 'IP Hijacking (Spider-Man)', 
    emoji: '🕷️',
    description: 'Uses pop-culture icons to distract you from uncanny AI artifacts and melting backgrounds.'
  },
  { id: 'type_organic_human', name: 'Verified Organic (Human)', emoji: '🌿', description: 'High-quality, organic human content. Use this to help train the model on what NOT to catch.' },
  ];

const UNIFIED_SLOP_RULES = [
  // --- Hard Blocks (Definitive Slop) ---
  { regex: /\bfollow\s+(me|@\w+)\b/gi, label: "Engagement Gate", description: "Clear signal of industrial audience capture.", points: 5 },
  { regex: /must follow/gi, label: "Engagement Gate", description: "Forced following to bypass algorithmic filters.", points: 5 },
  { regex: /\bcomment\b.{0,30}\bto (get|receive|join|access)\b/gi, label: "Comment Bait", description: "Tricks the algorithm into seeing organic engagement.", points: 5 },
  { regex: /\b(retweet|like\s+and\s+retweet)\b/gi, label: "Engagement Loop", description: "The most basic form of algorithmic currency extraction.", points: 5 },
  { regex: /\bbookmark\s+(this|it|now|thread|post)\b/gi, label: "Save/Bookmark Bait", description: "Exploits Miller's Law by overloading you with info to process now.", points: 5 },
  { regex: /\bsave\s+this\b/gi, label: "Save/Bookmark Bait", description: "Designed to increase post dwell-time and algorithmic 'saves'.", points: 5 },
  { regex: /\b(dm\s+me|dm\s+for|send\s+me\s+(a\s+)?dm)\b/gi, label: "Direct-Funnel Loop", description: "Moves the extraction into private messages to bypass public scrutiny.", points: 5 },
  { regex: /\$[\d,]+\+?\s*\/\s*(mo|month|day|week|hr|hour|year)/gi, label: "Income Claim", description: "Unverified financial promise designed to bypass logical skepticism.", points: 5 },
  { regex: /\$[\d,]+[k]?\s+per\s+(mo|month|day|week|hour)/gi, label: "Income Claim", description: "Specific, high-value financial hooks used by slop factories.", points: 5 },
  { regex: /\$[\d,]+.{0,40}(replac|instead of|consultant|lawyer|doctor|agency|degree|analyst|designer|copywriter)/gi, label: "Income Claim", description: "Claims that AI can replace high-value human professional services.", points: 5 },
  { regex: /\b(make|earn|generate|earning|making)\b.{0,20}\$[\d,]+/gi, label: "Income Claim", description: "Direct promises of unverified monetary gain.", points: 5 },
  { regex: /\b(money machine|cash machine|print money|income machine)\b/gi, label: "Hustle Buzzword", description: "Dehumanizes wealth generation into a mechanical, low-effort process.", points: 5 },
  { regex: /\bside\s+(hustle|income)\b/gi, label: "Aspirational Trap", description: "Targets workers with a fantasy of escaping the system.", points: 5 },
  { regex: /\bdata entry\b/gi, label: "Hustle Buzzword", description: "A common 'passive income' trope used to farm engagement.", points: 5 },
  { regex: /\bhere are\s+[1-9]\d*\b/gi, label: "List Formula", description: "Uses specific numbers to hack your brain's internal spam filter.", points: 5 },
  { regex: /\b[1-9]\d*\s+prompts?\b/gi, label: "Prompt List Formula", description: "Mass-produced prompt collections with low actual utility.", points: 5 },
  { regex: /\b[1-9]\d*\s+(tools?|hacks?|tricks?|ways?|tips?|secrets?|mistakes?|steps?)\b/gi, label: "List Formula", description: "Designed to provide 'value' that is just below the fold.", points: 5 },
  { regex: /\b(use these|try these|steal these|copy these)\b.{0,20}\b(prompts?|tools?|tricks?)\b/gi, label: "List Formula", description: "Encourages low-effort copy-pasting over genuine learning.", points: 5 },
  { regex: /\bact (as|like) (a |an )?(professional|expert|senior|world-class|harvard)/gi, label: "Institutional Launder", description: "Steals the credibility of elite brands to launder low-quality content.", points: 5 },
  { regex: /\bstep[\s-]by[\s-]step\b/gi, label: "List Formula", description: "Makes complex technology seem simple for the unqualified.", points: 5 },
  { regex: /\b[1-9]\d*\+?\s*free\s+(ai\s+)?courses?\b/gi, label: "Lead Magnet", description: "The 'value' is bait for a downstream product or newsletter.", points: 5 },
  // BREAKING: Only flag when followed by income/tool/free claims (not genuine news)
  { regex: /\bBREAKING\b.{0,80}(free|prompts?|\$[\d,]+|replac|for free|tool|hack|secret|cheat)/gi, label: "Clickbait Opener", description: "Artificially creates urgency to capture your initial scroll-speed.", points: 5 },
  { regex: /\bGOODBYE\b/g, label: "Clickbait Opener", description: "Uses finality to create a curiosity gap.", points: 5 },
  { regex: /\bR\.?I\.?P\.?\b/gi, label: "Clickbait Opener", description: "Uses fake finality to harvest engagement.", points: 5 },
  { regex: /\bSTOP (telling|using|doing|saying)\b/g, label: "Clickbait Opener", description: "Weaponizes authority to command your attention.", points: 5 },
  { regex: /\bCANCELLED\b.{0,60}(chatgpt|netflix|spotify|prime|subscription)/gi, label: "Clickbait Opener", description: "Exploits the fear of missing out on a 'magic button' solution.", points: 5 },
  { regex: /\b(most people don.t know|nobody (talks|is talking) about|very few (know|people)|hardly anyone|95% of people|99% of people)\b/gi, label: "Manufactured Consensus", description: "Weaponizes the fear that your peers are getting ahead of you.", points: 5 },
  { regex: /\bfor free\b/gi, label: "Lead Magnet", description: "Content is bait for a course blueprint or tool referral link.", points: 5 },
  { regex: /\bfaceless\b/gi, label: "Hustle Buzzword", description: "Promotes industrial content production without genuine intent.", points: 5 },
  { regex: /passive income/gi, label: "Hustle Buzzword", description: "Bait for a course blueprint or tool referral link.", points: 5 },
  { regex: /\bno (experience|skills?|coding|degree|team|budget|camera|luck)\b/gi, label: "Hustle Buzzword", description: "Lowers your critical guard by making success seem frictionless.", points: 5 },
  { regex: /\bzero to.{0,30}(income|money|\$)\b/gi, label: "Aspirational Trap", description: "The transformation story applied to a product or course funnel.", points: 5 },
  { regex: /\b(forget|ditch|quit|goodbye|replace)\s+chatgpt\b/gi, label: "Clickbait Opener", description: "Claims that all human work is replaceable by current AI wrappers.", points: 5 },
  { regex: /\b(giveaway|giving away)\b/gi, label: "Fake Giveaway", description: "Often a front for bot-network expansion.", points: 5 },
  { regex: /\b(prize|reward).{0,30}(follow|retweet|like|comment|enter)/gi, label: "Engagement Gate", description: "Engagement wall to harvest your account information.", points: 5 },
  { regex: /\bfree for \d+\s*hours?\b/gi, label: "Scarcity Bait", description: "Exploits the fear of missing out by creating fake time-pressure.", points: 5 },
  { regex: /\b(limited (spots?|seats?)|only \d+ spots?)\b/gi, label: "Scarcity Bait", description: "Uses specific, random numbers to make a scam look legitimate.", points: 5 },
  { regex: /\b(paid courses?).{0,30}free\b/gi, label: "Lead Magnet", description: "Fake pricing anchor to make slop look like a high-value gift.", points: 5 },
  { regex: /\ball paid.{0,20}free\b/gi, label: "Lead Magnet", description: "Designed to bypass your logical skepticism with 'free' value.", points: 5 },
  { regex: /\b(blueprint|masterclass|cheatsheet|playbook).{0,40}(free|get|dm|comment|follow)\b/gi, label: "Course Funnel", description: "Bait for a downstream product or tool referral link.", points: 5 },
  { regex: /\b(course|ebook|pdf).{0,40}\$[\d,]+\b/gi, label: "Course Funnel", description: "Direct monetization of engagement via informational products.", points: 5 },
  { regex: /\bgrok.{0,20}imagine\b/gi, label: "AI Promo", description: "Promotes AI tools using industrial engagement farming.", points: 5 },
  { regex: /\b(apob|pollo ai|seedance|heygen|synthesia)\b/gi, label: "AI Promo", description: "Specific tool promotions commonly found in slop networks.", points: 5 },
  { regex: /\bai\s+ugc\b/gi, label: "AI Promo", description: "Industrial content production disguised as organic user content.", points: 5 },
  { regex: /\bupload.{0,20}(photo|video|image).{0,40}(generate|create|make|turn into)\b/gi, label: "AI Promo", description: "Promotes AI creation tools through low-effort templates.", points: 5 },
  { regex: /\b(stop|still)\s+paying\s+for\b.{0,30}(storage|icloud|gmail|subscription)/gi, label: "Subscription Hook", description: "Targets your exhaustion with recurring fees to sell a 'magic button' solution.", points: 5 },
  { regex: /\bI\s+(found|discovered)\s+a\s+(way|secret|tool)\b/gi, label: "Curiosity Gap", description: "Claims of secret knowledge used to farm engagement.", points: 5 },
  { regex: /\b(I\s+)?hope\s+this\s+helps\s+you\s*↓/gi, label: "Engagement Ending", description: "Standardized call-to-action used in slop threads.", points: 5 },
  { regex: /\bstop\s+(declining|rejecting)\s+spam\s+calls\b/gi, label: "Fear-Based Hook", description: "Targets common annoyances with unverified solutions.", points: 5 },
  { regex: /\bif\s+your\s+iphone\s+gets\s+stolen\b/gi, label: "Fear-Based Hook", description: "Exploits anxiety about device security to extract attention.", points: 5 },
  { regex: /\b(most|9[59]% of)\s+(developers|students|people)\s+are\s+using\b.{0,30}\bwrong\b/gi, label: "Competence Gap", description: "Weaponizes the fear that you are falling behind your peers.", points: 5 },
  { regex: /\bsomeone\s+(built|leaked|compiled|just)\s+a\s+(tool|skill|system|repo|skill)\b/gi, label: "Third-Party Validation", description: "Uses fake institutional credibility to launder low-quality content.", points: 5 },
  { regex: /\b(your|a)\s+\$[\d,]+\s+camera\b.{0,50}\blosing\b/gi, label: "Comparison Hook", description: "Uses absurd gear comparisons to create scroll-stopping curiosity.", points: 5 },
  { regex: /\b(vibe\s+coding|claude\s+code|openclaw)\b/gi, label: "Trending Slop", description: "High-volume industrial farming of current AI keywords.", points: 5 },
  { regex: /\b(don.t|do\s+not)\s+change\s+the\s+iphone\b/gi, label: "Fear-Based Hook", description: "Uses fear of tech obsolescence to capture your scroll-speed.", points: 5 },
  { regex: /\bbest\s+for\s+(logic|writing|research|video)\b/gi, label: "Comparison Table", description: "Standardized AI model comparison templates used in slop.", points: 5 },

  // --- Soft Signals (Subtler Markers) ---
  { regex: /[\u{1D400}-\u{1D7FF}]/gu, label: "Bold Unicode Spam", description: "Uses custom characters to bypass filters and stand out visually.", points: 1 },
  { regex: /(changed my life|show more|read on|curiosity)/gi, label: "Curiosity Gap", description: "Exploits Loewenstein's Information Gap Theory to increase dwell time.", points: 0.5 },
  { regex: /\+.{0,20}\+.{0,20}=/g, label: "Math-Washing", description: "Weaponizes the Complexity Fallacy with oversimplified equations.", points: 1 }
];



// ---------------------------------------------------------------------------
// Scan result card (shown after a right-click scan)
// ---------------------------------------------------------------------------

function suggestSlopType(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('$10k') || t.includes('10,000') || t.includes('60 minutes')) return 'type_psych_burnout';
  if (t.includes('no skill') || t.includes('no luck')) return 'type_psych_imposter';
  if (t.includes('20 tools') || t.includes('10 tools')) return 'type_algo_overload';
  if (t.includes('comment') || t.includes('reply')) return 'type_algo_consensus';
  if (t.includes('harvard') || t.includes('google') || t.includes('mckinsey')) return 'type_struct_launder';
  if (t.includes('thread') || t.includes('🧵')) return 'type_algo_curiosity';
  return '';
}

function buildReportDetails(info) {
  const details = el('details', { class: 'zs-details' }, [el('summary', { text: 'Add details (optional)' })]);

  const selectId = 'zs-slop-type';
  const select = el('select', { id: selectId, class: 'zs-select' }, [el('option', { value: '', text: 'General slop' })]);
  const suggested = suggestSlopType(info?.text);
  SLOP_TYPES.filter((t) => t.id !== 'type_organic_human').forEach((t) => {
    const opt = el('option', { value: t.id, text: `${t.emoji} ${t.name}` });
    if (t.id === suggested) opt.selected = true;
    select.appendChild(opt);
  });
  const hint = el('div', { class: 'zs-hint' });
  const updateHint = () => {
    const selected = SLOP_TYPES.find((t) => t.id === select.value);
    hint.textContent = selected ? selected.description : 'Pick the tactic that fits best, or leave it as general slop.';
  };
  select.addEventListener('change', updateHint);
  updateHint();

  const check = (label) => {
    const input = el('input', { type: 'checkbox' });
    return { input, node: el('label', { class: 'zs-check' }, [input, label]) };
  };
  const accountable = check('No accountable author');
  const funnel = check('Contains a funnel or call to action');
  const replicable = check('Claims can’t be replicated');

  const shieldName = `zs-shield-${Date.now()}`;
  const radio = (value, label, checked = false) => {
    const input = el('input', { type: 'radio', name: shieldName, value, checked });
    return el('label', { class: 'zs-check' }, [input, label]);
  };

  details.append(
    el('label', { class: 'zs-field-label', for: selectId, text: 'Tactic' }), select, hint,
    el('div', { class: 'zs-field-label', text: 'Extraction test' }), accountable.node, funnel.node, replicable.node,
    el('div', { class: 'zs-field-label', text: 'Label the account as' }),
    radio('shield-none', 'Leave the account unlabelled', true),
    radio('shield-red', 'Slop factory (bot network, funnels)'),
    radio('shield-blue', 'High AI usage')
  );

  return {
    node: details,
    read: () => ({
      slopType: select.value,
      extractionResults: { accountability: accountable.input.checked, funnel: funnel.input.checked, replicability: replicable.input.checked },
      shieldType: details.querySelector(`input[name="${shieldName}"]:checked`)?.value || 'shield-none'
    })
  };
}

function autoCloseCard(card, delay = 4000) {
  let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => card.remove(), delay); };
  card.addEventListener('mouseenter', () => clearTimeout(timer));
  card.addEventListener('mouseleave', arm);
  arm();
}

function showResultCard({ state, pct = 0, words, scope = 'tweet', info, message }) {
  document.getElementById('zs-result-card')?.remove();

  const tone = state === 'error' ? 'red' : state === 'loading' ? 'blue' : scoreTone(pct);
  const card = el('section', {
    id: 'zs-result-card',
    class: `zs-surface zs-card zs-tone-${tone}`,
    role: state === 'error' ? 'alert' : 'dialog',
    'aria-label': 'ZeroSlop scan result',
    'aria-live': 'polite'
  });
  ['click', 'mousedown', 'pointerdown'].forEach((t) => card.addEventListener(t, (e) => e.stopPropagation()));

  const scopeLabel = { tweet: 'Post scan', thread: 'Thread scan', profile: 'Profile scan', selection: 'Selected text' }[scope] || 'Scan';
  card.appendChild(el('div', { class: 'zs-card-head' }, [
    el('span', { class: 'zs-eyebrow', text: state === 'error' ? 'ZeroSlop' : `ZeroSlop · ${scopeLabel}` }),
    el('button', { type: 'button', class: 'zs-icon-btn', 'aria-label': 'Close', onclick: () => card.remove() }, '×')
  ]));

  if (state === 'loading') {
    card.appendChild(el('div', { class: 'zs-loading' }, [
      el('div', { class: 'zs-spinner', 'aria-hidden': 'true' }),
      el('div', {}, [
        el('div', { class: 'zs-title', text: 'Scanning with ZeroGPT…' }),
        el('div', { class: 'zs-muted', text: 'This usually takes a few seconds.' })
      ])
    ]));
    document.body.appendChild(card);
    return;
  }

  if (state === 'error') {
    const missingKey = /api key/i.test(message || '');
    card.append(
      el('p', { class: 'zs-title', text: missingKey ? 'Add your ZeroGPT API key first' : 'The scan didn’t work' }),
      el('p', { class: 'zs-muted', style: 'margin: 6px 0 0', text: missingKey
        ? 'Deep scans use your own ZeroGPT key. Click the ZeroSlop icon in your toolbar, open Deep scan, and paste your key.'
        : (message || 'Please try again in a moment.') })
    );
    document.body.appendChild(card);
    return;
  }

  // Result
  const flagged = pct > ZS_AI_FLAG_THRESHOLD;
  const metaBits = [];
  if (words) metaBits.push(`${words} words`);
  if (scope === 'thread' || scope === 'profile') metaBits.push(`${info?.tweetCount || 'several'} posts combined`);
  metaBits.push('Scored by ZeroGPT');

  card.append(
    el('div', { class: 'zs-score' }, [
      el('span', { class: 'zs-score-num', text: `${pct}%` }),
      el('span', { class: 'zs-score-label', text: scoreVerdict(pct) })
    ]),
    el('div', { class: 'zs-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'AI likelihood' }, [
      el('span', { style: `width: ${Math.max(2, Math.min(100, pct))}%` })
    ]),
    el('div', { class: 'zs-muted', text: metaBits.join(' · ') })
  );

  const stack = el('div', { class: 'zs-stack' });
  const canReport = !!info && !!info.text;

  if (canReport) {
    const details = buildReportDetails(info);
    const finish = (text) => {
      stack.replaceChildren(el('div', { class: 'zs-confirm', role: 'status' }, [`✓ ${text}`]));
      autoCloseCard(card);
    };
    const report = el('button', { type: 'button', class: `zs-btn ${flagged ? 'zs-btn-danger' : 'zs-btn-secondary'}` }, 'Report as slop');
    const human = el('button', { type: 'button', class: `zs-btn ${flagged ? 'zs-btn-secondary' : 'zs-btn-primary'}` }, 'It’s human');

    report.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'manualReport', aiScore: pct, ...details.read(), ...info });
      finish('Reported to the registry. Thanks!');
    });
    human.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'manualReport', aiScore: 0, slopType: 'type_organic_human', shieldType: 'shield-green', ...info });
      finish('Marked as human. Thanks!');
    });

    stack.append(el('div', { class: 'zs-row' }, flagged ? [report, human] : [human, report]), details.node);
  }

  if (info?.author?.handle && info.author.handle !== '@anonymous' && flagged) {
    const poster = el('button', { type: 'button', class: 'zs-btn zs-btn-ghost' }, '🖼️ Copy a “wanted” poster');
    poster.addEventListener('click', () => {
      poster.disabled = true;
      poster.textContent = 'Making poster…';
      generateWantedPoster(info.author, pct)
        .then(() => zsToast('Poster copied to your clipboard.', { tone: 'green' }))
        .catch(() => zsToast('Couldn’t copy the poster. Your browser may have blocked clipboard access.', { tone: 'red' }))
        .finally(() => { poster.disabled = false; poster.textContent = '🖼️ Copy a “wanted” poster'; });
    });
    stack.append(poster);
  }

  if (stack.childNodes.length) card.appendChild(stack);
  document.body.appendChild(card);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

injectStyles();
syncTheme();
initObservers();
autoScanAmplifiers();
console.log(`ZeroSlop: content script v${ZS_VERSION} ready.`);
