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

let lastRightClickPoint = null;

document.addEventListener('contextmenu', (event) => {
  lastRightClickedElement = event.target;
  lastRightClickPoint = { x: event.clientX, y: event.clientY };
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
  postButton: true,
  slopAction: 'blur',
  hideThreshold: 85
};

let zsImageCache = {}; // mediaId -> this computer's image check result (saved by the background script)
let zsUserMarks = {}; // tweetId or "acct:handle" -> { verdict: 'slop' | 'not_slop', at }, the person's own answers

const zsSettingsReady = new Promise((resolve) => {
  chrome.storage.local.get([...Object.keys(zsSettings), 'imageCheckCache', 'userMarks'], (stored) => {
    for (const key of Object.keys(zsSettings)) {
      if (stored[key] !== undefined) zsSettings[key] = stored[key];
    }
    zsImageCache = stored.imageCheckCache || {};
    zsUserMarks = stored.userMarks || {};
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
  if (changes.imageCheckCache) zsImageCache = changes.imageCheckCache.newValue || {};
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
  /* Bot button in each post's action row (and on profiles) */
  .zs-action-wrap { display: flex; align-items: center; justify-content: flex-end; }
  .zs-action-wrap.zs-action-inline { display: inline-flex; margin-left: 4px; vertical-align: middle; }
  .zs-action-btn {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-width: 34px; height: 34px; padding: 0 8px; border-radius: 999px; cursor: pointer;
    color: var(--zs-muted); font: 700 13px var(--zs-font); transition: color .15s ease, background-color .15s ease;
  }
  .zs-action-inline .zs-action-btn { min-width: 26px; height: 26px; padding: 0 4px; }
  .zs-action-btn:hover { color: var(--zs-accent); background: color-mix(in srgb, var(--zs-accent) 12%, transparent); }
  .zs-action-btn:focus-visible { outline: 2px solid var(--zs-accent); outline-offset: 1px; }
  .zs-profile-btn { border: 1px solid var(--zs-border); color: var(--zs-fg); margin-top: 8px; padding: 0 12px; }

  /* Panel */
  .zs-panel { position: fixed; z-index: 2147483646; width: 340px; max-height: calc(100vh - 24px); overflow-y: auto; padding: 14px 16px 12px; animation: zsFade .12s ease-out; }
  .zs-panel .zs-title { margin: 0 0 10px; }
  .zs-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; margin: 0 0 10px; background: var(--zs-surface); border-radius: 10px; }
  .zs-seg button { all: unset; text-align: center; padding: 6px 4px; border-radius: 7px; cursor: pointer; font: 600 13px var(--zs-font); color: var(--zs-muted); }
  .zs-seg button.zs-seg-on { background: var(--zs-bg); color: var(--zs-fg); box-shadow: 0 1px 3px rgba(0,0,0,.15); }
  .zs-seg button:focus-visible { outline: 2px solid var(--zs-accent); }
  .zs-known { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .zs-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
    color: var(--zs-tone); background: color-mix(in srgb, var(--zs-tone) 12%, transparent); }
  .zs-results { margin-top: 8px; }
  .zs-result-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--zs-border); font-size: 13.5px; }
  .zs-row-label { font-weight: 600; }
  .zs-row-detail { font-size: 12px; color: var(--zs-muted); }
  .zs-row-score { font-weight: 800; color: var(--zs-tone); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .zs-row-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--zs-muted); white-space: nowrap; }
  .zs-spinner-sm { width: 14px; height: 14px; }
  .zs-link-btn { all: unset; cursor: pointer; color: var(--zs-accent); font: 600 12.5px var(--zs-font); margin-top: 2px; display: inline-block; }
  .zs-link-btn:hover { text-decoration: underline; }
  .zs-link-btn:focus-visible { outline: 2px solid var(--zs-accent); border-radius: 4px; }
  .zs-question { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--zs-border); }
  .zs-question-title { font-weight: 800; font-size: 15px; margin-bottom: 8px; }
  .zs-panel-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 12.5px; }

  .zs-media-picked { outline: 3px solid var(--zs-accent) !important; outline-offset: -3px; transition: outline-color .3s ease; }
  .zs-signs { margin: 10px 0 0; padding-left: 18px; font-size: 13px; }
  .zs-signs li { margin: 3px 0; }
  .zs-note { font-size: 12px; color: var(--zs-muted); margin: 12px 0 0; }
  .zs-flag { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 10px; border-radius: 10px; font-size: 13px; font-weight: 600;
    color: var(--zs-tone); background: color-mix(in srgb, var(--zs-tone) 12%, transparent); }
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
  if (zsPanel && !zsPanel.el.contains(e.target) && !(zsPanel.anchor && zsPanel.anchor.contains && zsPanel.anchor.contains(e.target))) closePanel();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (zsPopover) { closePopover({ restoreFocus: true }); return; }
  if (zsPanel) { closePanel({ restoreFocus: true }); return; }
  closeResultCard();
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
  if (typeof closePanel === 'function') closePanel();
  document.querySelectorAll('.zs-toast[data-notice]').forEach((n) => n.remove());
  document.querySelectorAll('.zs-header-badge').forEach((b) => b.remove());
  shownNotices.clear();
}

// ---------------------------------------------------------------------------
// Account status (registry lookups answered by the background script)
// ---------------------------------------------------------------------------

function applyAccountStatus(kind, handle, extra = {}) {
  if (!handle) return;
  const prev = zsAccountStatus.get(normHandle(handle));
  if (!prev || (BADGE_KINDS[kind]?.priority || 0) >= (BADGE_KINDS[prev]?.priority || 0)) zsAccountStatus.set(normHandle(handle), kind);

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
    case 'getMediaInfo':
      sendResponse(findMediaInfo(request.srcUrl));
      break;
    case 'imageCheckStatus':
      if (panelRequests.has(request.requestId)) { panelRequests.get(request.requestId).onStatus?.(request); break; }
      showImageCard({ state: 'progress', ...request });
      break;
    case 'imageCheckResult':
      showExplainResult(request);
      break;
    case 'imageDetectResult':
      if (panelRequests.has(request.requestId)) {
        const container = request.tweetId ? getTweetContainerByTweetId(request.tweetId) : null;
        if (container) setBadge(container, imageBadgeSpec({ score: request.result.score, kind: request.kind, source: 'local', mediaId: request.mediaId }));
        panelRequests.get(request.requestId).resolve(request.result.score);
        break;
      }
      showDetectResult(request);
      break;
    case 'openPanelFromMenu':
      openPanelFromMenu();
      break;
    case 'imageCheckError':
      if (panelRequests.has(request.requestId)) { panelRequests.get(request.requestId).resolve(null); break; }
      showImageCard({ state: 'error', ...request });
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
      closeResultCard();
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
  injectPostButton(container);
  applyStoredImageResults(container);
  applyUserMark(container);
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
    injectProfileButton();
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

  let profileButtonQueued = false;
  const mutationObserver = new MutationObserver((mutations) => {
    // The profile header renders after navigation, so retry adding its button (at most once per frame).
    if (!profileButtonQueued && currentProfileHandle()) {
      profileButtonQueued = true;
      requestAnimationFrame(() => { profileButtonQueued = false; injectProfileButton(); });
    }
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
// Scan result card (legacy ZeroGPT result; errors such as a missing API key)
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

/** Close the open card. An image check in progress keeps running and reports back with a toast. */
function closeResultCard() {
  const card = document.getElementById('zs-result-card');
  if (!card) return;
  if (card.dataset.requestId) dismissedImageChecks.add(card.dataset.requestId);
  card.remove();
}

function showResultCard({ state, pct = 0, words, scope = 'tweet', info, message }) {
  closeResultCard();

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
// On-device image check: media lookup, detector results and Gemma explanations
// ---------------------------------------------------------------------------

const IMAGE_VERDICTS = {
  likely_ai: { tone: 'amber', title: 'Likely AI-generated', label: 'AI image?' },
  unclear: { tone: 'gray', title: 'Hard to tell', label: 'Image unclear' },
  likely_real: { tone: 'green', title: 'Looks like a real image', label: 'Image looks real' }
};
const dismissedImageChecks = new Set();

const isCdnImage = (u) => typeof u === 'string' && /^https:\/\/pbs\.twimg\.com\//.test(u);
const mediaLabels = new Map(); // image URL -> "image 2 of 3", shown on the result card

/** Ask X's CDN for the medium size, which is big enough for the model without being slow. */
function mediumSize(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('name')) u.searchParams.set('name', 'medium');
    return u.href;
  } catch (e) {
    return url;
  }
}

function backgroundImageUrl(node) {
  const match = node && getComputedStyle(node).backgroundImage.match(/url\("?([^")]+)"?\)/);
  return match ? match[1] : null;
}

/** Every photo, video and link-preview image in a post, in reading order. */
function collectPostMedia(article) {
  const items = [];
  const seen = new Set();
  const add = (node, url, kind) => {
    if (!isCdnImage(url) || seen.has(url)) return;
    seen.add(url);
    // Media inside a quoted post sits in a nested link card.
    const quoted = !!node.closest('div[role="link"]') && node.closest('div[role="link"]') !== article;
    items.push({ node, url, kind, quoted });
  };

  article.querySelectorAll('video').forEach((video) => {
    const box = video.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]') || video.parentElement;
    const poster = isCdnImage(video.poster) ? video.poster : box?.querySelector('img')?.src;
    add(box || video, poster, 'video');
    if (items.length && items[items.length - 1].url === poster) items[items.length - 1].video = video;
  });
  article.querySelectorAll('[data-testid="tweetPhoto"]').forEach((photo) => {
    if (photo.querySelector('video')) return; // Already counted as a video.
    const img = photo.querySelector('img');
    add(photo, img?.src || backgroundImageUrl(photo.querySelector('div[style*="background-image"]')), 'image');
  });
  article.querySelectorAll('[data-testid^="card.layout"] img').forEach((img) => add(img.closest('[data-testid^="card.layout"]') || img, img.src, 'image'));

  // Keep document order so "image 2 of 3" matches what's on screen.
  items.sort((a, b) => (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return items;
}

/** Pick the media item under (or nearest to) the right-click, preferring the post's own media over a quoted post's. */
function pickMedia(items, point) {
  const own = items.filter((m) => !m.quoted);
  const pool = own.length ? own : items;
  if (!point) return pool[0];
  let best = null;
  let bestDist = Infinity;
  for (const m of items) {
    const r = m.node.getBoundingClientRect();
    const inside = point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
    if (inside) return m; // Right-clicked on it directly (including a quoted post's media).
    if (!pool.includes(m)) continue;
    const dx = Math.max(r.left - point.x, 0, point.x - r.right);
    const dy = Math.max(r.top - point.y, 0, point.y - r.bottom);
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) { bestDist = dist; best = m; }
  }
  return best || pool[0];
}

function flashPicked(node) {
  if (!node) return;
  node.classList.add('zs-media-picked');
  setTimeout(() => node.classList.remove('zs-media-picked'), 1600);
}

/** Find the photo or video to check for the post the user right-clicked. */
function findMediaInfo(srcUrl) {
  const target = lastRightClickedElement;
  const article = getTweetContainer(target);
  const info = article ? extractTweetInfo(article) : null;
  const tweetId = info && !String(info.tweetId).startsWith('local-') ? info.tweetId : null;

  if (article) {
    const items = collectPostMedia(article);
    // The browser told us exactly which image was right-clicked.
    const sizeless = (u) => { try { const x = new URL(u); x.searchParams.delete('name'); return x.href; } catch (e) { return u; } };
    let picked = isCdnImage(srcUrl) ? items.find((m) => sizeless(m.url) === sizeless(srcUrl)) : null;
    if (!picked && items.length) picked = pickMedia(items, lastRightClickPoint);
    if (picked) {
      // Count within the same post (own media vs the quoted post's) and the same kind.
      const sameKind = items.filter((m) => m.kind === picked.kind && m.quoted === picked.quoted);
      const label = sameKind.length > 1 ? `${picked.kind} ${sameKind.indexOf(picked) + 1} of ${sameKind.length}` : picked.kind;
      const url = mediumSize(picked.url);
      mediaLabels.set(url, picked.quoted ? `${label} in the quoted post` : label);
      flashPicked(picked.node);
      const frame = picked.kind === 'video' ? captureVideoFrame(picked.video) : null;
      return {
        url, tweetId, kind: picked.kind, mediaId: mediaIdFromUrl(url),
        author: info?.author?.handle && info.author.handle !== '@anonymous' ? info.author.handle : null,
        frames: frame ? [frame] : []
      };
    }
  }

  // Outside a post (for example the full-screen photo viewer): use what's under the cursor.
  let url = isCdnImage(srcUrl) ? srcUrl : null;
  if (!url && target && target.closest) {
    const img = target.closest('img') || target.closest('[data-testid="tweetPhoto"]')?.querySelector('img');
    if (img && isCdnImage(img.src)) url = img.src;
    const video = target.closest('video') || target.closest('[data-testid="videoPlayer"]')?.querySelector('video');
    if (!url && video && isCdnImage(video.poster)) url = video.poster;
  }
  if (!url) return { url: null, tweetId };
  url = mediumSize(url);
  mediaLabels.set(url, 'image');
  return { url, tweetId, kind: 'image', mediaId: mediaIdFromUrl(url), author: null, frames: [] };
}

function imageCardShell(requestId, tone) {
  const existing = document.getElementById('zs-result-card');
  if (existing && existing.dataset.requestId !== (requestId || '')) closeResultCard();
  else existing?.remove();
  const card = el('section', {
    id: 'zs-result-card',
    class: `zs-surface zs-card zs-tone-${tone}`,
    role: 'dialog',
    'aria-label': 'ZeroSlop image check',
    'aria-live': 'polite',
    'data-request-id': requestId || ''
  });
  ['click', 'mousedown', 'pointerdown'].forEach((t) => card.addEventListener(t, (e) => e.stopPropagation()));
  card.appendChild(el('div', { class: 'zs-card-head' }, [
    el('span', { class: 'zs-eyebrow', text: 'ZeroSlop · Image check' }),
    el('button', {
      type: 'button', class: 'zs-icon-btn', 'aria-label': 'Close',
      onclick: () => { if (requestId) dismissedImageChecks.add(requestId); card.remove(); }
    }, '×')
  ]));
  return card;
}

const IMAGE_STAGE_TEXT = {
  // Gemma 4 explanation
  starting: ['Starting Gemma 4…', 'This runs entirely on your computer.'],
  downloading: ['Downloading Gemma 4…', 'One-time download. You can keep browsing.'],
  loading: ['Loading Gemma 4…', 'This takes a little longer the first time after a restart.'],
  analyzing: ['Explaining the image…', 'Looking for AI artifacts and watermarks.']
};
const DETECT_STAGE_TEXT = {
  starting: ['Starting the AI-image detector…', 'The first check downloads it once (87 MB).'],
  downloading: ['Downloading the detector…', 'One-time download.'],
  loading: ['Loading the detector…', 'Almost ready.'],
  analyzing: ['Checking the image…', 'Usually under a second.']
};

function sizeText(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function showImageCard(opts) {
  const { state, requestId } = opts;
  if (requestId && dismissedImageChecks.has(requestId) && state === 'progress') return;

  // Progress updates arrive often: update the open card in place instead of rebuilding it.
  const open = document.getElementById('zs-result-card');
  if (state === 'progress' && open && open.dataset.requestId === requestId && open.dataset.state === 'progress') {
    updateImageProgress(open, opts);
    return;
  }

  if (state === 'progress') {
    const card = imageCardShell(requestId, 'blue');
    card.dataset.state = 'progress';
    card.append(
      el('div', { class: 'zs-loading' }, [
        el('div', { class: 'zs-spinner', 'aria-hidden': 'true' }),
        el('div', { style: 'flex: 1; min-width: 0' }, [
          el('div', { class: 'zs-title', 'data-role': 'title' }),
          el('div', { class: 'zs-muted', 'data-role': 'detail' })
        ])
      ]),
      el('div', { class: 'zs-meter', 'data-role': 'meter', role: 'progressbar', 'aria-label': 'Model download', 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true }, [el('span', { style: 'width: 0%' })])
    );
    document.body.appendChild(card);
    updateImageProgress(card, opts);
    return;
  }

  if (state === 'error') {
    if (requestId && dismissedImageChecks.has(requestId)) {
      zsToast(errorText(opts).title, { tone: 'red' });
      return;
    }
    const card = imageCardShell(requestId, 'red');
    card.dataset.state = 'error';
    const { title, body } = errorText(opts);
    card.append(
      el('p', { class: 'zs-title', text: title }),
      el('p', { class: 'zs-muted', style: 'margin: 6px 0 0', text: body })
    );
    document.body.appendChild(card);
  }
}

function errorText({ code, message }) {
  if (code === 'no-webgpu') {
    return { title: 'This browser can’t run the image model', body: 'The image check needs WebGPU, which isn’t available here. Recent Chrome and Brave support it on most computers.' };
  }
  if (code === 'no-image') {
    return { title: 'No photo or video in this post', body: 'Open the ZeroSlop panel on a post that has a photo or video, then choose Check.' };
  }
  if (code === 'image-fetch') {
    return { title: 'Couldn’t load that image', body: 'X may have removed it, or the connection dropped. Try again in a moment.' };
  }
  return { title: 'The image check didn’t work', body: message || 'Please try again.' };
}

function updateImageProgress(card, { stage = 'starting', progress, loaded, total, mode }) {
  const texts = mode === 'detect' ? DETECT_STAGE_TEXT : IMAGE_STAGE_TEXT;
  const [title, detail] = texts[stage] || texts.starting;
  card.querySelector('[data-role="title"]').textContent = title;
  const meter = card.querySelector('[data-role="meter"]');
  const showBar = (stage === 'downloading' || stage === 'loading') && typeof progress === 'number';
  meter.hidden = !showBar;
  let detailText = detail;
  if (showBar) {
    const pct = Math.max(0, Math.min(100, Math.round(progress)));
    meter.firstChild.style.width = `${pct}%`;
    meter.setAttribute('aria-valuenow', String(pct));
    if (stage === 'downloading' && total) {
      detailText = `${pct}% · ${sizeText(loaded)} of ${sizeText(total)}. You can keep browsing.`;
    } else {
      detailText = `${pct}%`;
    }
  }
  card.querySelector('[data-role="detail"]').textContent = detailText;
}

function showExplainResult({ requestId, tweetId, url, result }) {
  const base = IMAGE_VERDICTS[result?.verdict] || IMAGE_VERDICTS.unclear;
  const mediaLabel = mediaLabels.get(url) || 'image';
  const isVideo = mediaLabel.startsWith('video');
  // Say "video" when we checked a video's preview frame.
  const verdict = isVideo
    ? { ...base, label: base.label.replace('image', 'video').replace('Image', 'Video'), title: base.title.replace('image', 'video') }
    : base;
  const checkedWhat = isVideo
    ? `Checked the preview frame of ${mediaLabel === 'video' ? 'the video' : mediaLabel}.`
    : `Checked ${mediaLabel === 'image' ? 'the image' : mediaLabel}.`;
  const signs = result?.signs || [];
  const confidence = result?.confidence || 0;

  // A visible AI watermark is strong evidence, so it replaces the detector's label on the post.
  const container = tweetId ? getTweetContainerByTweetId(tweetId) : null;
  if (container && result?.watermark) {
    setBadge(container, {
      kind: 'image-watermark',
      priority: 27,
      replace: true,
      tone: 'red',
      label: 'AI watermark',
      title: `AI watermark spotted: ${result.watermark}`,
      desc: `${checkedWhat} ${signs.length ? `Signs: ${signs.join('; ')}.` : ''}`.trim(),
      meta: 'Spotted by Gemma 4 on this device. It can be wrong.'
    });
  }
  const detectorScore = zsImageCache[mediaIdFromUrl(url)]?.score;

  const render = () => {
    const card = imageCardShell(requestId, result?.watermark ? 'red' : verdict.tone);
    card.dataset.state = 'result';
    card.append(...[
      el('div', { class: 'zs-eyebrow', style: 'margin-bottom: 4px', text: 'Gemma 4’s explanation' }),
      el('div', { class: 'zs-score' }, [el('span', { class: 'zs-score-label', style: 'font-size: 20px; color: var(--zs-tone)', text: verdict.title })]),
      el('div', { class: 'zs-muted', style: 'margin-top: 4px', text: `${checkedWhat} ${confidence ? `Model confidence: ${confidence}%.` : ''}`.trim() }),
      typeof detectorScore === 'number' ? el('div', { class: 'zs-muted', style: 'margin-top: 2px', text: `The detector scored it ${detectorScore}% likely AI.` }) : null,
      result?.watermark ? el('div', { class: 'zs-flag zs-tone-red' }, [`Watermark spotted: ${result.watermark}`]) : null,
      result?.bait ? el('div', { class: 'zs-flag zs-tone-amber' }, ['Looks like engagement bait']) : null,
      signs.length ? el('ul', { class: 'zs-signs', 'aria-label': 'Signs the model noticed' }, signs.map((sign) => el('li', { text: sign }))) : null,
      el('p', { class: 'zs-note', text: 'Checked by Gemma 4 on your computer. Nothing was uploaded. The model can be wrong, especially with realistic photos.' })
    ].filter(Boolean));
    document.body.appendChild(card);
  };

  if (requestId && dismissedImageChecks.has(requestId)) {
    zsToast(`Explanation ready: ${verdict.title.toLowerCase()}.`, {
      tone: result?.watermark ? 'red' : verdict.tone,
      actions: [{ label: 'Show result', onClick: render }]
    });
    return;
  }
  render();
}


/** Registry ID for an image on X's CDN: its path, e.g. /media/ABC123 -> "media_ABC123". */
function mediaIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'pbs.twimg.com') return null;
    const id = u.pathname.replace(/^\/+/, '').replace(/\.(jpg|jpeg|png|webp)$/i, '').replace(/[^A-Za-z0-9_.-]+/g, '_');
    return id.length >= 3 && id.length <= 300 ? id : null;
  } catch (e) {
    return null;
  }
}

/** The frame a playing (or paused) video is showing, as a JPEG, so a video gets more than its preview image checked. */
function captureVideoFrame(video) {
  try {
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch (e) {
    return null; // The browser may refuse to read the frame; the preview image is still checked.
  }
}

function detectTone(score) {
  if (score >= 70) return 'red';
  if (score >= 50) return 'amber';
  return 'green';
}

function detectVerdict(score) {
  if (score >= 70) return 'Likely AI-generated';
  if (score >= 50) return 'Possibly AI-generated';
  if (score >= 30) return 'Hard to tell';
  return 'Likely real';
}

const IMAGE_REGISTRY_MIN_SCORE = 50; // Automatic labels from the registry only for likely-AI media.

function imageBadgeSpec({ score, kind = 'image', source, checks = 1, avg, mediaId }) {
  const what = kind === 'video' ? 'video' : 'image';
  return {
    kind: 'image',
    priority: 25,
    replace: true,
    tone: detectTone(score),
    label: `${score}% AI ${what}`,
    title: `${what === 'video' ? 'Video' : 'Image'}: ${detectVerdict(score).toLowerCase()} (${score}%)`,
    desc: source === 'local'
      ? `You checked this ${what} on your computer with the Community Forensics detector.`
      : `Checked ${checks} ${checks === 1 ? 'time' : 'times'} by the community, averaging ${avg ?? score}%.`,
    meta: 'Detectors can be wrong, especially with screenshots and heavily compressed images.',
    actions: () => voteActions(`img:${mediaId}`, (voteType) => chrome.runtime.sendMessage({ action: 'voteImage', mediaId, voteType }))
  };
}

/** Label a post from this computer's earlier checks, or from the community registry. */
function applyStoredImageResults(article) {
  if (!article) return;
  const items = collectPostMedia(article)
    .map((m) => ({ ...m, id: mediaIdFromUrl(m.url) }))
    .filter((m) => m.id);
  if (!items.length) return;

  let best = null;
  for (const m of items) {
    const saved = zsImageCache[m.id];
    if (saved && (!best || saved.score > best.score)) best = { ...saved, mediaId: m.id };
  }
  if (best) {
    setBadge(article, imageBadgeSpec({ ...best, source: 'local' }));
    return;
  }

  if (zsSettings.communityShield === false) return;
  chrome.runtime.sendMessage({ action: 'checkImageRegistry', mediaIds: items.map((m) => m.id) }, (entries) => {
    if (chrome.runtime.lastError || !entries) return;
    let top = null;
    for (const [id, entry] of Object.entries(entries)) {
      if (entry.downvotes > entry.upvotes + 2) continue; // The community disagrees with this score.
      if (!top || entry.avg > top.avg) top = { ...entry, mediaId: id };
    }
    if (top && top.avg >= IMAGE_REGISTRY_MIN_SCORE) {
      setBadge(article, imageBadgeSpec({ score: top.avg, kind: top.kind, source: 'registry', checks: top.checks, avg: top.avg, mediaId: top.mediaId }));
    }
  });
}

function showDetectResult({ requestId, tweetId, url, mediaId, kind, result, community }) {
  const score = result?.score ?? 0;
  const isVideo = kind === 'video';
  const mediaLabel = mediaLabels.get(url) || kind || 'image';
  const what = isVideo ? 'video' : 'image';
  const checkedWhat = isVideo
    ? `Checked ${mediaLabel === 'video' ? 'the video' : mediaLabel}: ${result?.framesChecked > 1 ? `preview and ${result.framesChecked - 1} frame${result.framesChecked > 2 ? 's' : ''}, averaged` : 'preview image'}.`
    : `Checked ${mediaLabel === 'image' ? 'the image' : mediaLabel}.`;

  const container = tweetId ? getTweetContainerByTweetId(tweetId) : null;
  if (container) setBadge(container, imageBadgeSpec({ score, kind, source: 'local', mediaId }));

  const render = () => {
    const card = imageCardShell(requestId, detectTone(score));
    card.dataset.state = 'result';

    const voteRow = el('div', { class: 'zs-row', style: 'align-items: center; margin-top: 12px' });
    const voteKey = `img:${mediaId}`;
    const showVoted = (type) => voteRow.replaceChildren(el('div', { class: 'zs-muted', role: 'status', text: type === 'up' ? '✓ Thanks, you said this looks right.' : '✓ Thanks, you said this looks wrong.' }));
    if (zsVotes.get(voteKey)) {
      showVoted(zsVotes.get(voteKey));
    } else {
      const vote = (type) => () => {
        zsVotes.set(voteKey, type);
        chrome.runtime.sendMessage({ action: 'voteImage', mediaId, voteType: type });
        showVoted(type);
      };
      voteRow.append(
        el('span', { class: 'zs-muted', style: 'flex: none', text: 'Is this right?' }),
        el('button', { type: 'button', class: 'zs-btn zs-btn-secondary', onclick: vote('up') }, '👍 Yes'),
        el('button', { type: 'button', class: 'zs-btn zs-btn-secondary', onclick: vote('down') }, '👎 No')
      );
    }

    const explain = el('button', { type: 'button', class: 'zs-btn zs-btn-ghost', style: 'margin-top: 6px; align-self: flex-start' }, 'Explain why with Gemma 4');
    chrome.storage.local.get(['imageModelReady'], ({ imageModelReady }) => {
      if (!imageModelReady) explain.textContent = 'Explain why with Gemma 4 (3.4 GB download)';
    });
    explain.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'explainImage', url, tweetId, mediaId });
      showImageCard({ state: 'progress', requestId: `explain-${requestId}`, stage: 'starting' });
    });

    const communityText = community && community.checks > 1
      ? `Checked ${community.checks} times by the community, averaging ${community.avg}%.`
      : 'First check of this ' + what + ' in the community registry.';

    card.append(...[
      el('div', { class: 'zs-score' }, [
        el('span', { class: 'zs-score-num', text: `${score}%` }),
        el('span', { class: 'zs-score-label', text: detectVerdict(score) })
      ]),
      el('div', { class: 'zs-meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(score), 'aria-label': `Likelihood the ${what} is AI-generated` }, [
        el('span', { style: `width: ${Math.max(2, Math.min(100, score))}%` })
      ]),
      el('div', { class: 'zs-muted', text: checkedWhat }),
      el('div', { class: 'zs-muted', style: 'margin-top: 2px', text: communityText }),
      voteRow,
      el('div', { style: 'display: flex' }, [explain]),
      el('p', { class: 'zs-note', text: 'Scored on your computer by the Community Forensics detector. The image stayed on your computer; only the score was shared with the community registry. Detectors can be wrong, especially with screenshots and heavily compressed images.' })
    ]);
    document.body.appendChild(card);
  };

  if (requestId && dismissedImageChecks.has(requestId)) {
    zsToast(`Image check finished: ${score}% likely AI.`, { tone: detectTone(score), actions: [{ label: 'Show result', onClick: render }] });
    return;
  }
  render();
}


// ---------------------------------------------------------------------------
// The ZeroSlop panel: one place to check content and say whether it's slop.
//
// Opened from the bot button on a post or profile, or from the right-click "ZeroSlop…" item.
// It works out what you're looking at (post, thread, image, video or account), runs the right
// check, and always lets the person decide. Scans inform; people mark.
// ---------------------------------------------------------------------------

const BOT_ICON = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1.2"/><circle cx="9" cy="13.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="13.5" r="1.3" fill="currentColor" stroke="none"/><path d="M2 12.5v3M22 12.5v3"/></svg>';
const USER_MARK_LIMIT = 1000;
const zsAccountStatus = new Map(); // normalized handle -> 'factory' | 'highai' | 'organic' | 'suspicious'
const panelRequests = new Map(); // image detect requestId -> { onStatus, resolve }
let zsPanel = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.userMarks) zsUserMarks = changes.userMarks.newValue || {};
  if (area === 'local' && changes.postButton) {
    if (changes.postButton.newValue === false) document.querySelectorAll('.zs-action-wrap').forEach((b) => b.remove());
    else document.querySelectorAll('article').forEach((a) => injectPostButton(a));
  }
});

function saveUserMark(key, verdict) {
  if (verdict) zsUserMarks[key] = { verdict, at: Date.now() };
  else delete zsUserMarks[key];
  const keys = Object.keys(zsUserMarks);
  if (keys.length > USER_MARK_LIMIT) {
    keys.sort((a, b) => zsUserMarks[a].at - zsUserMarks[b].at).slice(0, keys.length - USER_MARK_LIMIT).forEach((k) => delete zsUserMarks[k]);
  }
  chrome.storage.local.set({ userMarks: zsUserMarks });
}

function userMarkBadge(article, verdict) {
  if (!article) return;
  const existing = article.querySelector('.zs-badge[data-kind="marked"]');
  if (!verdict) { existing?.remove(); return; }
  const slop = verdict === 'slop';
  setBadge(article, {
    kind: 'marked', priority: 60, replace: true, tone: slop ? 'red' : 'green',
    label: slop ? 'You: slop' : 'You: not slop',
    title: slop ? 'You marked this as slop' : 'You marked this as not slop',
    desc: 'Your answer was added to the community registry.',
    actions: [{ label: 'Change', variant: 'secondary', onClick: () => { closePopover(); openPanelFor(article); } }]
  });
}

/** Re-apply the person's own marks when posts scroll back into view. */
function applyUserMark(article) {
  const id = extractTweetInfo(article).tweetId;
  const mark = zsUserMarks[id];
  if (mark) userMarkBadge(article, mark.verdict);
}

// ---- The bot button ----

function botButton(label, onClick) {
  const btn = el('button', { type: 'button', class: 'zs-action-btn', 'aria-label': label, title: 'ZeroSlop' });
  btn.innerHTML = BOT_ICON;
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => { stop(e); onClick(btn); });
  return btn;
}

function injectPostButton(article) {
  if (zsSettings.postButton === false || !article || article.querySelector('.zs-action-wrap')) return;
  const button = botButton('ZeroSlop: check this post or mark it as slop', (btn) => openPanelFor(article, btn));
  const wrap = el('div', { class: 'zs-action-wrap' }, [button]);
  // X's action row (reply, repost, like, views, bookmark, share). Fall back to beside the timestamp.
  const bar = Array.from(article.querySelectorAll('[role="group"]')).pop();
  if (bar && bar.closest('article') === article) {
    bar.appendChild(wrap);
  } else {
    const time = article.querySelector('time');
    const anchor = time ? (time.closest('a') || time) : null;
    if (!anchor) return;
    wrap.classList.add('zs-action-inline');
    anchor.after(wrap);
  }
}

function injectProfileButton() {
  const handle = currentProfileHandle();
  if (!handle || zsSettings.postButton === false) return;
  const header = document.querySelector('[data-testid="UserName"]');
  if (!header || header.querySelector('.zs-profile-btn')) return;
  // Read the handle on click: X can reuse the header element when moving between profiles.
  const button = botButton(`ZeroSlop: check @${handle} or mark the account as slop`, (btn) => {
    const current = currentProfileHandle();
    if (current) openPanel(buildProfileContext(current), btn);
  });
  button.classList.add('zs-profile-btn');
  button.append(el('span', { text: 'ZeroSlop' }));
  header.appendChild(el('div', { class: 'zs-header-badge' }, [button]));
}

// ---- What are we looking at? ----

function postMedia(article) {
  return collectPostMedia(article)
    .filter((m) => !m.quoted)
    .map((m) => ({ ...m, url: mediumSize(m.url), mediaId: mediaIdFromUrl(m.url) }))
    .filter((m) => m.mediaId);
}

function buildPostContext(article) {
  const info = extractTweetInfo(article);
  const handle = info.author?.handle && info.author.handle !== '@anonymous' ? info.author.handle : null;
  const media = postMedia(article);
  // On a post's own page, the author's other posts in view form the thread.
  const statusMatch = window.location.pathname.match(/\/status\/(\d+)/);
  const thread = statusMatch && handle ? tweetsByHandle(handle) : [];
  const scopes = ['post'];
  if (thread.length >= 2) scopes.push('thread');
  if (handle) scopes.push('account');
  const isFocalPost = statusMatch && statusMatch[1] === info.tweetId;
  return {
    type: 'post', article, info, handle, media, thread, scopes,
    scope: isFocalPost && thread.length >= 2 ? 'thread' : 'post'
  };
}

function buildProfileContext(handle) {
  const at = `@${handle}`;
  const header = document.querySelector('[data-testid="UserName"]');
  const name = header?.querySelector('span')?.innerText || '';
  const pfp = document.querySelector('a[href$="/photo"] img')?.src || '';
  return { type: 'profile', handle: at, author: { handle: at, name, pfp }, scopes: ['account'], scope: 'account', thread: [], media: [] };
}

function openPanelFor(article, anchor) {
  openPanel(buildPostContext(article), anchor || article.querySelector('.zs-action-btn') || article);
}

function mediaSummary(media) {
  const images = media.filter((m) => m.kind === 'image').length;
  const videos = media.filter((m) => m.kind === 'video').length;
  const parts = [];
  if (images) parts.push(`${images} ${images === 1 ? 'image' : 'images'}`);
  if (videos) parts.push(`${videos} ${videos === 1 ? 'video' : 'videos'}`);
  return parts.join(', ');
}

function scopeSummary(ctx) {
  const at = ctx.handle ? `@${normHandle(ctx.handle)}` : 'this account';
  if (ctx.scope === 'thread') return `Thread · ${ctx.thread.length} posts by ${at}`;
  if (ctx.scope === 'account') return `Account · ${at}`;
  const media = mediaSummary(ctx.media);
  return `Post by ${at}${media ? ` · ${media}` : ctx.info?.text ? ' · text' : ''}`;
}

function accountAuthor(ctx) {
  return ctx.type === 'profile' ? ctx.author : { ...(ctx.info?.author || {}), handle: ctx.handle };
}

/** Labels ZeroSlop already has for this scope, shown before the person decides. */
function knownLabels(ctx) {
  const chips = [];
  if (ctx.scope === 'post' && ctx.article) {
    const badges = Array.from(ctx.article.querySelectorAll('.zs-badge')).map((b) => b._zsSpec).filter(Boolean);
    for (const spec of badges) {
      if (spec.kind === 'marked') continue;
      chips.push({ tone: spec.tone, text: spec.title || spec.label });
    }
    for (const m of ctx.media) {
      const saved = zsImageCache[m.mediaId];
      if (saved && !badges.some((b) => b.kind === 'image')) chips.push({ tone: detectTone(saved.score), text: `${m.kind === 'video' ? 'Video' : 'Image'}: ${saved.score}% likely AI (your earlier check)` });
    }
  }
  if (ctx.scope === 'account' || ctx.scope === 'thread') {
    const status = ctx.handle && zsAccountStatus.get(normHandle(ctx.handle));
    if (status && BADGE_KINDS[status]) chips.push({ tone: BADGE_KINDS[status].tone, text: `Account: ${BADGE_KINDS[status].title.toLowerCase()}` });
  }
  const mark = zsUserMarks[markKey(ctx)];
  if (mark) chips.push({ tone: mark.verdict === 'slop' ? 'red' : 'green', text: mark.verdict === 'slop' ? 'You marked this as slop' : 'You marked this as not slop' });
  return chips;
}

function markKey(ctx) {
  if (ctx.scope === 'account') return `acct:${normHandle(ctx.handle)}`;
  if (ctx.scope === 'thread') return extractTweetInfo(ctx.thread[0]).tweetId;
  return ctx.info?.tweetId;
}

// ---- Panel rendering ----

function closePanel({ restoreFocus = false } = {}) {
  if (!zsPanel) return;
  const { el: node, anchor } = zsPanel;
  node.remove();
  zsPanel = null;
  if (restoreFocus && anchor?.isConnected && anchor.focus) anchor.focus();
}

function positionPanel(node, anchor) {
  const rect = (anchor && anchor.isConnected ? anchor : document.body).getBoundingClientRect();
  const box = node.getBoundingClientRect();
  let top = rect.bottom + 8;
  if (top + box.height > window.innerHeight - 12) top = Math.max(12, rect.top - box.height - 8);
  let left = rect.right - box.width;
  left = Math.min(Math.max(12, left), window.innerWidth - box.width - 12);
  node.style.top = `${Math.max(12, top)}px`;
  node.style.left = `${left}px`;
}

function openPanel(ctx, anchor) {
  closePopover();
  closeResultCard();
  if (zsPanel && zsPanel.ctx.article === ctx.article && zsPanel.ctx.type === ctx.type && ctx.type === 'post') { closePanel(); return; }
  closePanel();

  const node = el('section', { class: 'zs-surface zs-panel', role: 'dialog', 'aria-labelledby': 'zs-panel-title' });
  ['click', 'mousedown', 'pointerdown'].forEach((t) => node.addEventListener(t, (e) => e.stopPropagation()));
  zsPanel = { el: node, ctx, anchor, results: {}, busy: false, knownAtOpen: {} };
  renderPanel();
  document.body.appendChild(node);
  positionPanel(node, anchor);
  node.querySelector('.zs-panel-primary, button')?.focus({ preventScroll: true });
}

function renderPanel() {
  if (!zsPanel) return;
  const { el: node, ctx, results } = zsPanel;
  const scopeLabels = { post: 'Post', thread: `Thread (${ctx.thread.length})`, account: 'Account' };

  const head = el('div', { class: 'zs-card-head' }, [
    el('span', { class: 'zs-eyebrow', text: 'ZeroSlop' }),
    el('button', { type: 'button', class: 'zs-icon-btn', 'aria-label': 'Close', onclick: () => closePanel({ restoreFocus: true }) }, '×')
  ]);

  const scopeSwitch = ctx.scopes.length > 1
    ? el('div', { class: 'zs-seg', role: 'radiogroup', 'aria-label': 'What to check' }, ctx.scopes.map((s) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(ctx.scope === s), class: ctx.scope === s ? 'zs-seg-on' : '',
      onclick: () => { if (zsPanel.busy) return; ctx.scope = s; zsPanel.results = {}; renderPanel(); }
    }, scopeLabels[s])))
    : null;

  // Snapshot per scope, taken before any check, so new results show only in the results list.
  if (!zsPanel.knownAtOpen[ctx.scope]) zsPanel.knownAtOpen[ctx.scope] = knownLabels(ctx);
  const chips = zsPanel.knownAtOpen[ctx.scope];
  const known = el('div', { class: 'zs-known' }, chips.length
    ? chips.map((c) => el('span', { class: `zs-chip zs-tone-${c.tone || 'gray'}` }, [el('span', { class: 'zs-dot', 'aria-hidden': 'true' }), c.text]))
    : [el('span', { class: 'zs-muted', text: 'Nothing known about this yet.' })]);

  const checkLabel = { post: ctx.media.length ? 'Check this post and its media' : 'Check this post', thread: 'Check the whole thread', account: 'Check this account' }[ctx.scope];
  const checkBtn = el('button', { type: 'button', class: 'zs-btn zs-btn-secondary zs-btn-block', disabled: zsPanel.busy }, results.checked ? 'Check again' : checkLabel);
  checkBtn.addEventListener('click', () => runPanelCheck());

  const resultRows = el('div', { class: 'zs-results', 'aria-live': 'polite' }, Object.values(results.rows || {}).map(resultRow));

  node.replaceChildren(...[
    head,
    el('p', { class: 'zs-title', id: 'zs-panel-title', text: scopeSummary(ctx) }),
    scopeSwitch,
    known,
    checkBtn,
    resultRows,
    renderQuestion(ctx),
    renderExtras(ctx)
  ].filter(Boolean));
}

function resultRow(row) {
  const right = row.state === 'running'
    ? el('span', { class: 'zs-row-status' }, [el('span', { class: 'zs-spinner zs-spinner-sm', 'aria-hidden': 'true' }), row.status || 'Checking…'])
    : row.state === 'error'
      ? el('span', { class: 'zs-row-status zs-muted', text: row.status })
      : el('span', { class: `zs-row-score zs-tone-${row.tone}`, text: row.value });
  const node = el('div', { class: 'zs-result-row' }, [
    el('div', { style: 'min-width: 0' }, [el('div', { class: 'zs-row-label', text: row.label }), row.detail ? el('div', { class: 'zs-row-detail', text: row.detail }) : null]),
    right
  ]);
  if (row.explain) {
    node.querySelector('div').appendChild(el('button', { type: 'button', class: 'zs-link-btn', onclick: row.explain }, 'Explain with Gemma 4'));
  }
  return node;
}

function renderQuestion(ctx) {
  const isAccount = ctx.scope === 'account';
  const at = ctx.handle ? `@${normHandle(ctx.handle)}` : 'this account';
  const question = isAccount ? `Is ${at} a slop account?` : ctx.scope === 'thread' ? 'Is this thread slop?' : 'Is this post slop?';
  const hint = zsPanel.results.checked
    ? 'Checks can be wrong. Your answer is what counts.'
    : 'You can answer without checking first.';

  const yes = el('button', { type: 'button', class: 'zs-btn zs-btn-danger zs-panel-primary', disabled: zsPanel.busy }, 'Yes, it’s slop');
  const no = el('button', { type: 'button', class: 'zs-btn zs-btn-secondary', disabled: zsPanel.busy }, isAccount ? 'No, a real person' : 'No');
  yes.addEventListener('click', () => answerPanel('slop'));
  no.addEventListener('click', () => answerPanel('not_slop'));

  return el('div', { class: 'zs-question' }, [
    el('div', { class: 'zs-question-title', text: question }),
    el('div', { class: 'zs-row' }, [yes, no]),
    el('div', { class: 'zs-hint', text: hint }),
    renderDetails(ctx)
  ]);
}

function renderDetails(ctx) {
  const details = el('details', { class: 'zs-details', style: 'margin-top: 10px' }, [el('summary', { text: 'Add details (optional)' })]);
  const form = {};
  if (ctx.scope === 'account') {
    const name = `zs-acct-${Date.now()}`;
    form.factory = el('input', { type: 'radio', name, value: 'shield-red', checked: true });
    form.highai = el('input', { type: 'radio', name, value: 'shield-blue' });
    details.append(
      el('div', { class: 'zs-field-label', text: 'If it’s slop, label the account as' }),
      el('label', { class: 'zs-check' }, [form.factory, 'Slop factory (bot networks, funnels)']),
      el('label', { class: 'zs-check' }, [form.highai, 'High AI use'])
    );
  } else {
    const text = ctx.scope === 'thread' ? ctx.thread.map((a) => extractTweetInfo(a).text).join('\n') : ctx.info?.text;
    form.tactic = el('select', { id: 'zs-tactic', class: 'zs-select' }, [el('option', { value: '', text: 'General slop' })]);
    const suggested = suggestSlopType(text);
    SLOP_TYPES.filter((t) => t.id !== 'type_organic_human').forEach((t) => {
      const opt = el('option', { value: t.id, text: `${t.emoji} ${t.name}` });
      if (t.id === suggested) opt.selected = true;
      form.tactic.appendChild(opt);
    });
    const box = (label, checked = false) => { const input = el('input', { type: 'checkbox', checked }); return { input, node: el('label', { class: 'zs-check' }, [input, label]) }; };
    form.accountability = box('No accountable author');
    form.funnel = box('Contains a funnel or call to action');
    form.replicability = box('Claims can’t be replicated');
    form.flag = ctx.handle ? box(`Also flag @${normHandle(ctx.handle)} as a slop factory`) : null;
    form.amplifiers = box('Find accounts that amplified it (opens 2 tabs briefly)');
    details.append(
      el('label', { class: 'zs-field-label', for: 'zs-tactic', text: 'Tactic' }), form.tactic,
      el('div', { class: 'zs-field-label', text: 'Extraction test' }), form.accountability.node, form.funnel.node, form.replicability.node,
      el('div', { class: 'zs-field-label', text: 'More' }), form.flag?.node, form.amplifiers.node
    );
  }
  zsPanel.form = form;
  return details;
}

function renderExtras(ctx) {
  const author = accountAuthor(ctx);
  if (!author?.handle) return null;
  const poster = el('button', { type: 'button', class: 'zs-link-btn' }, 'Copy a “wanted” poster');
  poster.addEventListener('click', () => {
    const score = Math.max(0, ...Object.values(zsPanel.results.rows || {}).map((r) => r.number || 0));
    generateWantedPoster(author, score)
      .then(() => zsToast('Poster copied to your clipboard.', { tone: 'green' }))
      .catch(() => zsToast('Couldn’t copy the poster. Your browser may have blocked clipboard access.', { tone: 'red' }));
  });
  return el('div', { class: 'zs-panel-footer' }, [poster, el('a', { href: ZS_REGISTRY_URL, target: '_blank', rel: 'noopener', text: 'Registry ↗' })]);
}

function setRow(key, row) {
  if (!zsPanel) return;
  zsPanel.results.rows = { ...(zsPanel.results.rows || {}), [key]: { ...(zsPanel.results.rows?.[key] || {}), ...row } };
  renderPanel();
}

// ---- Checks ----

function localSlopScore(text) {
  const prediction = text && text.length > 20 ? ZeroSlopClassifier.predict(text) : null;
  if (!prediction) return null;
  return Math.round((1 - prediction.probabilities['organic-human']) * 100);
}

async function hasZeroGptKey() {
  const { zerogptApiKey } = await chrome.storage.local.get(['zerogptApiKey']);
  return !!zerogptApiKey;
}

async function checkText(key, label, text, { tweetId, author } = {}) {
  if (!text || text.trim().length < 20) {
    setRow(key, { label, state: 'error', status: 'Too little text to check' });
    return null;
  }
  setRow(key, { label, state: 'running', status: 'Checking…' });
  if (await hasZeroGptKey()) {
    const res = await chrome.runtime.sendMessage({ action: 'zerogptScore', text, tweetId, author });
    if (res && typeof res.score === 'number') {
      setRow(key, { label, state: 'done', detail: 'ZeroGPT', value: `${res.score}% AI`, number: res.score, tone: scoreTone(res.score) });
      return res.score;
    }
  }
  const local = localSlopScore(text);
  if (local === null) {
    setRow(key, { label, state: 'error', status: 'Couldn’t check the text' });
    return null;
  }
  setRow(key, { label, state: 'done', detail: 'On-device model (slop signals)', value: `${local}%`, number: local, tone: detectTone(local) });
  return local;
}

/** Run the image detector on one media item and resolve with its score (or null). */
function detectMediaScore(m, { tweetId, author, onStatus } = {}) {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { panelRequests.delete(requestId); resolve(null); }, 120000);
    panelRequests.set(requestId, {
      onStatus,
      resolve: (score) => { clearTimeout(timer); panelRequests.delete(requestId); resolve(score); }
    });
    const frame = m.kind === 'video' ? captureVideoFrame(m.video) : null;
    chrome.runtime.sendMessage({
      action: 'detectMedia', requestId,
      media: { url: m.url, tweetId, kind: m.kind, mediaId: m.mediaId, author, frames: frame ? [frame] : [] }
    });
  });
}

function mediaRowLabel(m, i, list) {
  const same = list.filter((x) => x.kind === m.kind);
  const n = same.length > 1 ? ` ${same.indexOf(m) + 1}` : '';
  return `${m.kind === 'video' ? 'Video' : 'Image'}${n}`;
}

async function checkMedia(ctx) {
  const tweetId = ctx.info?.tweetId;
  const scores = {};
  await Promise.all(ctx.media.map(async (m, i, list) => {
    const key = `media:${m.mediaId}`;
    const label = mediaRowLabel(m, i, list);
    setRow(key, { label, state: 'running', status: 'Checking…' });
    const score = await detectMediaScore(m, {
      tweetId, author: ctx.handle,
      onStatus: (s) => {
        const status = s.stage === 'downloading' && s.total
          ? `Downloading detector ${Math.round(s.progress || 0)}%`
          : s.stage === 'starting' ? 'Starting detector…' : 'Checking…';
        setRow(key, { state: 'running', status });
      }
    });
    if (typeof score === 'number') {
      scores[m.mediaId] = score;
      setRow(key, {
        state: 'done', value: `${score}% AI`, number: score, tone: detectTone(score),
        detail: m.kind === 'video' ? 'Detector · preview frame' : 'AI-image detector',
        explain: () => {
          closePanel();
          chrome.runtime.sendMessage({ action: 'explainImage', url: m.url, tweetId, mediaId: m.mediaId });
          showImageCard({ state: 'progress', requestId: `explain-${m.mediaId}`, stage: 'starting' });
        }
      });
    } else {
      setRow(key, { state: 'error', status: 'Couldn’t check it' });
    }
  }));
  return scores;
}

async function runPanelCheck() {
  if (!zsPanel || zsPanel.busy) return;
  const ctx = zsPanel.ctx;
  zsPanel.busy = true;
  zsPanel.results = { rows: {} };
  renderPanel();
  try {
    if (ctx.scope === 'post') {
      const jobs = [];
      if (ctx.info?.text) jobs.push(checkText('text', 'Text', ctx.info.text, { tweetId: ctx.info.tweetId, author: ctx.info.author }));
      if (ctx.media.length) jobs.push(checkMedia(ctx).then((s) => { zsPanel && (zsPanel.mediaScores = s); }));
      if (!jobs.length) setRow('none', { label: 'Nothing to check', state: 'error', status: 'No text or media' });
      await Promise.all(jobs);
    } else if (ctx.scope === 'thread') {
      const posts = ctx.thread.map((a) => extractTweetInfo(a));
      const text = posts.map((p) => p.text).filter(Boolean).join('\n\n');
      await checkText('text', `Thread text (${posts.length} posts)`, text, { tweetId: posts[0]?.tweetId, author: posts[0]?.author });
    } else {
      await checkAccount(ctx);
    }
  } finally {
    if (zsPanel && zsPanel.ctx === ctx) {
      zsPanel.busy = false;
      zsPanel.results.checked = true;
      renderPanel();
    }
  }
}

async function checkAccount(ctx) {
  setRow('registry', { label: 'Community registry', state: 'running', status: 'Looking up…' });
  const data = await chrome.runtime.sendMessage({ action: 'checkProfileSlop', handle: ctx.handle }).catch(() => null);
  if (data && data.highSlopCount) {
    setRow('registry', { state: 'done', detail: `${data.highSlopCount} AI-heavy posts on record`, value: `avg ${data.avgScore}%`, number: data.avgScore, tone: scoreTone(data.avgScore) });
  } else {
    setRow('registry', { state: 'error', status: 'No posts on record' });
  }
  const posts = tweetsByHandle(ctx.handle).map((a) => extractTweetInfo(a).text).filter((t) => t && t.length > 20);
  if (!posts.length) {
    setRow('visible', { label: 'Posts on screen', state: 'error', status: 'None to check here' });
    return;
  }
  const scores = posts.map(localSlopScore).filter((x) => x !== null);
  const sloppy = scores.filter((x) => x >= 70).length;
  const pct = Math.round((sloppy / scores.length) * 100);
  setRow('visible', { label: 'Posts on screen', detail: 'On-device model', state: 'done', value: `${sloppy} of ${scores.length} look like slop`, number: pct, tone: detectTone(pct) });
}

// ---- Answers ----

async function ensureMediaScores(ctx) {
  const scores = { ...(zsPanel?.mediaScores || {}) };
  const missing = ctx.media.filter((m) => typeof scores[m.mediaId] !== 'number' && typeof zsImageCache[m.mediaId]?.score !== 'number');
  ctx.media.forEach((m) => { if (typeof scores[m.mediaId] !== 'number' && typeof zsImageCache[m.mediaId]?.score === 'number') scores[m.mediaId] = zsImageCache[m.mediaId].score; });
  if (missing.length) {
    const got = await Promise.all(missing.map((m) => detectMediaScore(m, { tweetId: ctx.info?.tweetId, author: ctx.handle })));
    missing.forEach((m, i) => { if (typeof got[i] === 'number') scores[m.mediaId] = got[i]; });
  }
  return scores;
}

function readForm() {
  const f = zsPanel?.form || {};
  return {
    slopType: f.tactic?.value || '',
    extractionResults: f.accountability ? { accountability: f.accountability.input.checked, funnel: f.funnel.input.checked, replicability: f.replicability.input.checked } : null,
    flagAccount: !!f.flag?.input.checked,
    findAmplifiers: !!f.amplifiers?.input.checked,
    accountShield: f.highai?.checked ? 'shield-blue' : 'shield-red'
  };
}

async function answerPanel(verdict) {
  if (!zsPanel || zsPanel.busy) return;
  const ctx = zsPanel.ctx;
  const form = readForm();
  const slop = verdict === 'slop';
  const textScore = zsPanel.results.rows?.text?.detail === 'ZeroGPT' ? zsPanel.results.rows.text.number : 0;
  const actions = [];
  const marked = []; // [article, key] to label locally

  zsPanel.busy = true;
  renderPanel();

  if (ctx.scope === 'post') {
    const { tweetId, text, author } = ctx.info;
    actions.push(slop
      ? { type: 'reportPost', tweetId, text, author, aiScore: textScore, slopType: form.slopType, extractionResults: form.extractionResults, shieldType: form.flagAccount ? 'shield-red' : undefined, findAmplifiers: form.findAmplifiers }
      : { type: 'reportPost', tweetId, text, author, aiScore: 0, slopType: 'type_organic_human' });
    if (ctx.article.querySelector('.zs-badge[data-kind="score"]')) actions.push({ type: 'votePost', tweetId, voteType: slop ? 'up' : 'down' });
    if (ctx.media.length) {
      setRow('saving', { label: 'Saving with image scores', state: 'running', status: 'Checking media…' });
      const scores = await ensureMediaScores(ctx);
      for (const m of ctx.media) {
        if (typeof scores[m.mediaId] === 'number') actions.push({ type: 'markImage', mediaId: m.mediaId, url: m.url, kind: m.kind, score: scores[m.mediaId], tweetId, author: ctx.handle, verdict });
      }
    }
    marked.push([ctx.article, tweetId]);
  } else if (ctx.scope === 'thread') {
    ctx.thread.slice(0, 10).forEach((article, i) => {
      const { tweetId, text, author } = extractTweetInfo(article);
      actions.push(slop
        ? { type: 'reportPost', tweetId, text, author, aiScore: i === 0 ? textScore : 0, slopType: form.slopType, extractionResults: form.extractionResults, shieldType: i === 0 && form.flagAccount ? 'shield-red' : undefined, findAmplifiers: i === 0 && form.findAmplifiers }
        : { type: 'reportPost', tweetId, text, author, aiScore: 0, slopType: 'type_organic_human' });
      marked.push([article, tweetId]);
    });
  } else {
    const author = accountAuthor(ctx);
    const status = zsAccountStatus.get(normHandle(ctx.handle));
    if (status === 'factory' || status === 'highai') {
      // Already labelled: the answer counts as agreeing or disagreeing.
      actions.push({ type: 'voteAccount', handle: ctx.handle, voteType: slop ? 'up' : 'down' });
      if (slop && form.accountShield === 'shield-blue' && status === 'factory') actions.push({ type: 'reportAccount', author, shieldType: 'shield-blue' });
    } else {
      actions.push({ type: 'reportAccount', author, shieldType: slop ? form.accountShield : 'shield-green' });
    }
    marked.push([null, `acct:${normHandle(ctx.handle)}`]);
  }

  const batchId = crypto.randomUUID();
  const previous = marked.map(([, key]) => [key, zsUserMarks[key]?.verdict || null]);
  chrome.runtime.sendMessage({ action: 'queueSlopActions', batchId, actions });
  marked.forEach(([article, key]) => { saveUserMark(key, verdict); userMarkBadge(article, verdict); });

  const what = ctx.scope === 'account' ? `@${normHandle(ctx.handle)}` : ctx.scope === 'thread' ? 'Thread' : 'Post';
  const message = slop ? `${what} marked as slop.` : `${what} marked as not slop.`;
  closePanel({ restoreFocus: true });
  zsToast(message, {
    tone: slop ? 'red' : 'green',
    timeout: 5000,
    actions: [{
      label: 'Undo',
      onClick: async () => {
        const res = await chrome.runtime.sendMessage({ action: 'cancelSlopActions', batchId }).catch(() => null);
        if (res && res.cancelled) {
          previous.forEach(([key, verdictBefore]) => saveUserMark(key, verdictBefore));
          marked.forEach(([article, key]) => userMarkBadge(article, zsUserMarks[key]?.verdict || null));
          zsToast('Undone. Nothing was sent.', { tone: 'gray' });
        } else {
          zsToast('Too late to undo: it was already sent. Open the panel to change your answer.', { tone: 'amber' });
        }
      }
    }]
  });
}

function openPanelFromMenu() {
  const article = getTweetContainer(lastRightClickedElement);
  if (article) {
    openPanelFor(article, article.querySelector('.zs-action-btn') || lastRightClickedElement || article);
    return;
  }
  const handle = currentProfileHandle();
  if (handle) {
    openPanel(buildProfileContext(handle), document.querySelector('.zs-profile-btn') || document.querySelector('[data-testid="UserName"]'));
    return;
  }
  zsToast('Right-click a post or open a profile to use ZeroSlop.', { tone: 'gray' });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

injectStyles();
syncTheme();
initObservers();
autoScanAmplifiers();
console.log(`ZeroSlop: content script v${ZS_VERSION} ready.`);
