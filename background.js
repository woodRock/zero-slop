// Firebase Configuration
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDDx5ZbgWcgsKxsP78EubqyWRHL9yxdXec",
  projectId: "zero-slop"
};

// Initialize context menu: one item that opens the ZeroSlop panel for whatever was right-clicked.
// The panel itself works out whether that's a post, thread, image, video or profile.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "zeroSlopOpen",
      title: "ZeroSlop…",
      contexts: ["all"],
      documentUrlPatterns: ["*://*.twitter.com/*", "*://*.x.com/*"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "zeroSlopOpen") {
    chrome.tabs.sendMessage(tab.id, { action: "openPanelFromMenu", srcUrl: info.srcUrl || null }).catch(() => {});
  }
});

function scanAmplifiers(tweetId) {
  const quoteUrl = `https://x.com/i/status/${tweetId}/quotes?zerogpt_scan=true`;
  const retweetUrl = `https://x.com/i/status/${tweetId}/retweets?zerogpt_scan=true`;
  
  chrome.tabs.create({ url: quoteUrl, active: false });
  chrome.tabs.create({ url: retweetUrl, active: false });
}

// ---------------------------------------------------------------------------
// On-device image check (runs Gemma 4 in an offscreen document, see offscreen.js)
// ---------------------------------------------------------------------------

const IMAGE_MODEL_SIZE = "3.4 GB";
const DETECTOR_SIZE = "87 MB";
const DETECTOR_MODEL = "buildborderless/CommunityForensics-DeepfakeDet-ViT";
const FIRESTORE_DB = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)`;
const firestoreUrl = (path) => `${FIRESTORE_DB}/${path}?key=${FIREBASE_CONFIG.apiKey}`;
const firestoreDoc = (path) => `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${path}`;
const IMAGE_CACHE_LIMIT = 500;
const imageRegistryCache = new Map(); // mediaId -> { data, timestamp }
const IMAGE_FOUND_TTL = 6 * 60 * 60 * 1000;
const IMAGE_MISSING_TTL = 60 * 60 * 1000;
const IMAGE_STORAGE_PREFIX = "imgreg_";

// ---------------------------------------------------------------------------
// Firestore read budget
//
// The registry runs on Firestore's free plan (about 50,000 document reads a day, shared by
// every user and the website). Lookups that run for every post on screen are cached in
// memory and in chrome.storage.local, "not found" is cached too, and after a 429 (quota
// exceeded) no reads are sent for a while.
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const QUOTA_BACKOFF_MIN = 5 * 60 * 1000;
const QUOTA_BACKOFF_MAX = 60 * 60 * 1000;
let firestoreBackoffUntil = 0;
let firestoreBackoffMs = 0;
const backoffLoaded = chrome.storage.local.get(["firestoreBackoff"]).then(({ firestoreBackoff }) => {
  if (firestoreBackoff) {
    firestoreBackoffUntil = Math.max(firestoreBackoffUntil, firestoreBackoff.until || 0);
    firestoreBackoffMs = Math.max(firestoreBackoffMs, firestoreBackoff.ms || 0);
  }
}).catch(() => {});

async function firestoreBackingOff() {
  await backoffLoaded;
  return Date.now() < firestoreBackoffUntil;
}

/** Call with every Firestore read response. A 429 pauses reads, doubling each time up to an hour. */
function noteFirestoreResponse(response) {
  if (response.status === 429) {
    firestoreBackoffMs = Math.min(firestoreBackoffMs ? firestoreBackoffMs * 2 : QUOTA_BACKOFF_MIN, QUOTA_BACKOFF_MAX);
    firestoreBackoffUntil = Date.now() + firestoreBackoffMs;
    console.warn(`ZeroSlop: Registry quota exceeded; pausing lookups for ${Math.round(firestoreBackoffMs / 60000)} min`);
    chrome.storage.local.set({ firestoreBackoff: { until: firestoreBackoffUntil, ms: firestoreBackoffMs } });
  } else if (response.ok && firestoreBackoffMs) {
    firestoreBackoffMs = 0;
    chrome.storage.local.remove("firestoreBackoff");
  }
}

const lookupMemory = new Map(); // storageKey -> { data, timestamp }
const lookupInFlight = new Map(); // storageKey -> Promise
const LOOKUP_MEMORY_LIMIT = 5000;
const LOOKUP_PREFIXES = ["cache_", "acct_", "susp_", "prof_", IMAGE_STORAGE_PREFIX];

function rememberLookup(storageKey, entry) {
  lookupMemory.delete(storageKey);
  lookupMemory.set(storageKey, entry);
  if (lookupMemory.size > LOOKUP_MEMORY_LIMIT) lookupMemory.delete(lookupMemory.keys().next().value);
}

function forgetLookup(storageKey) {
  lookupMemory.delete(storageKey);
  chrome.storage.local.remove(storageKey);
}

/**
 * Cached single-document lookup.
 * fetcher() resolves to { found: true, data } / { found: false }, or throws on any other failure
 * (network, 429, 5xx), which is not cached. While backing off, or when the fetch fails, the last
 * cached value is returned even if it has expired.
 */
async function cachedLookup(storageKey, fetcher, { foundTtl, missingTtl }) {
  const fresh = (entry) => entry && Date.now() - entry.timestamp < (entry.data ? foundTtl : missingTtl);

  let entry = lookupMemory.get(storageKey);
  if (fresh(entry)) return entry.data;

  if (!entry) {
    const stored = (await chrome.storage.local.get([storageKey]))[storageKey];
    if (stored && typeof stored.timestamp === "number") {
      entry = { data: stored.data ?? null, timestamp: stored.timestamp };
      rememberLookup(storageKey, entry);
      if (fresh(entry)) return entry.data;
    }
  }

  if (await firestoreBackingOff()) return entry ? entry.data : null;

  if (lookupInFlight.has(storageKey)) return lookupInFlight.get(storageKey);
  const request = (async () => {
    try {
      const { found, data } = await fetcher();
      const next = { data: found ? data : null, timestamp: Date.now() };
      rememberLookup(storageKey, next);
      chrome.storage.local.set({ [storageKey]: next });
      return next.data;
    } catch (e) {
      return entry ? entry.data : null;
    } finally {
      lookupInFlight.delete(storageKey);
    }
  })();
  lookupInFlight.set(storageKey, request);
  return request;
}

/** GET one Firestore document. 404 means "not found"; any other failure throws. */
async function fetchFirestoreDoc(path) {
  const response = await fetch(firestoreUrl(`documents/${path}`));
  noteFirestoreResponse(response);
  if (response.ok) return { found: true, doc: await response.json() };
  if (response.status === 404) return { found: false };
  throw new Error(`Firestore read failed: HTTP ${response.status}`);
}

// Drop expired lookup entries from storage, at most once a day.
async function pruneLookupStorage() {
  const { lookupPrunedAt = 0 } = await chrome.storage.local.get(["lookupPrunedAt"]);
  if (Date.now() - lookupPrunedAt < 24 * HOUR) return;
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((key) =>
    LOOKUP_PREFIXES.some((p) => key.startsWith(p)) &&
    !(all[key] && typeof all[key].timestamp === "number" && Date.now() - all[key].timestamp < 7 * 24 * HOUR)
  );
  if (stale.length) await chrome.storage.local.remove(stale);
  await chrome.storage.local.set({ lookupPrunedAt: Date.now() });
}
pruneLookupStorage().catch(() => {});

// Image registry document IDs come from X's CDN path, e.g. "media_ABC123". Reject anything else.
function validMediaId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_.-]{3,300}$/.test(id) && id !== "." && id !== "..";
}

async function requestImageDetect(tabId, media, panelRequestId = null) {
  if (!media || !media.url || !validMediaId(media.mediaId)) {
    chrome.tabs.sendMessage(tabId, { action: "imageCheckError", mode: "detect", requestId: panelRequestId, code: "no-image", message: "No photo or video was found in that post." });
    return;
  }
  const requestId = panelRequestId || crypto.randomUUID();
  const { detectorReady } = await chrome.storage.local.get(["detectorReady"]);
  chrome.tabs.sendMessage(tabId, { action: "imageCheckStatus", mode: "detect", requestId, tweetId: media.tweetId || null, stage: detectorReady ? "analyzing" : "starting", size: DETECTOR_SIZE });
  try {
    await ensureOffscreenDocument();
    await sendToOffscreen({
      type: "detectImage", requestId, tabId, url: media.url, frames: (media.frames || []).slice(0, 4),
      tweetId: media.tweetId || null, mediaId: media.mediaId, kind: media.kind || "image", author: media.author || null
    });
  } catch (e) {
    console.error("ZeroSlop: Could not start the image detector", e);
    chrome.tabs.sendMessage(tabId, { action: "imageCheckError", mode: "detect", requestId, code: "failed", message: "The image detector couldn’t start." });
  }
}

function parseImageDoc(doc) {
  const f = doc.fields || {};
  const num = (v) => Number(v?.doubleValue ?? v?.integerValue ?? 0);
  const checks = num(f.checks);
  return {
    checks,
    scoreSum: num(f.score_sum),
    avg: checks ? Math.round(num(f.score_sum) / checks) : Math.round(num(f.ai_score)),
    upvotes: num(f.upvotes),
    downvotes: num(f.downvotes),
    markedSlop: num(f.marked_slop),
    markedNotSlop: num(f.marked_not_slop),
    kind: f.kind?.stringValue || "image",
    model: f.model?.stringValue || ""
  };
}

function setImageCache(id, entry) {
  imageRegistryCache.set(id, entry);
  if (imageRegistryCache.size > IMAGE_CACHE_LIMIT * 4) imageRegistryCache.delete(imageRegistryCache.keys().next().value);
  chrome.storage.local.set({ [IMAGE_STORAGE_PREFIX + id]: entry });
}

function deleteImageCache(id) {
  imageRegistryCache.delete(id);
  chrome.storage.local.remove(IMAGE_STORAGE_PREFIX + id);
}

/**
 * Look up image results in the community registry. Returns { mediaId: entry } for those found.
 * Results are cached in memory and chrome.storage.local (found for 6 hours, not found for 1 hour).
 * fresh: skip the cache, unless Firestore is refusing requests.
 */
async function getImageRegistry(mediaIds, { fresh = false } = {}) {
  const ids = [...new Set(mediaIds.filter(validMediaId))].slice(0, 20);
  const result = {};
  const isFresh = (entry) => entry && Date.now() - entry.timestamp < (entry.data ? IMAGE_FOUND_TTL : IMAGE_MISSING_TTL);

  // Fill the memory cache from storage for ids it doesn't know yet (e.g. after the worker restarts).
  const unknown = ids.filter((id) => !imageRegistryCache.has(id));
  if (unknown.length) {
    const stored = await chrome.storage.local.get(unknown.map((id) => IMAGE_STORAGE_PREFIX + id));
    for (const id of unknown) {
      const entry = stored[IMAGE_STORAGE_PREFIX + id];
      if (entry && typeof entry.timestamp === "number") imageRegistryCache.set(id, { data: entry.data ?? null, timestamp: entry.timestamp });
    }
  }

  const useCached = (id) => {
    const cached = imageRegistryCache.get(id);
    if (cached?.data) result[id] = cached.data;
  };

  const missing = [];
  for (const id of ids) {
    if (!fresh && isFresh(imageRegistryCache.get(id))) useCached(id);
    else missing.push(id);
  }
  if (!missing.length) return result;

  if (await firestoreBackingOff()) {
    missing.forEach(useCached); // stale is better than nothing
    return result;
  }

  try {
    const response = await fetch(firestoreUrl("documents:batchGet"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: missing.map((id) => firestoreDoc(`image_registry/${id}`)) })
    });
    noteFirestoreResponse(response);
    if (!response.ok) {
      missing.forEach(useCached);
      return result;
    }
    const rows = await response.json();
    for (const row of rows) {
      const name = row.found?.name || row.missing || "";
      const id = name.split("/").pop();
      if (!validMediaId(id)) continue;
      const data = row.found ? parseImageDoc(row.found) : null;
      setImageCache(id, { data, timestamp: Date.now() });
      if (data) result[id] = data;
    }
  } catch (e) {
    console.error("ZeroSlop: Image registry lookup failed", e);
    missing.forEach(useCached);
  }
  return result;
}

async function storeImageResult(msg) {
  const { mediaId, url, tweetId, kind, author, result } = msg;
  const fields = {
    media_id: { stringValue: mediaId },
    media_url: { stringValue: url || "" },
    kind: { stringValue: kind || "image" },
    ai_score: { doubleValue: result.score },
    model: { stringValue: result.model || DETECTOR_MODEL },
    last_checked: { timestampValue: new Date().toISOString() }
  };
  if (tweetId) fields.tweet_id = { stringValue: tweetId };
  if (author) fields.author_handle = { stringValue: author };

  const name = firestoreDoc(`image_registry/${mediaId}`);
  const body = {
    writes: [
      // Mask: only touch these fields, so votes and counts are kept.
      { update: { name, fields }, updateMask: { fieldPaths: Object.keys(fields) } },
      {
        transform: {
          document: name,
          fieldTransforms: [
            { fieldPath: "checks", increment: { integerValue: 1 } },
            { fieldPath: "score_sum", increment: { doubleValue: result.score } }
          ]
        }
      }
    ]
  };
  try {
    const response = await fetch(firestoreUrl("documents:commit"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) console.error("ZeroSlop: Image registry write failed", await response.text());
  } catch (e) {
    console.error("ZeroSlop: Image registry write failed", e);
  }
}

async function voteImage(mediaId, voteType) {
  if (!validMediaId(mediaId)) return;
  const body = {
    writes: [{
      transform: {
        document: firestoreDoc(`image_registry/${mediaId}`),
        fieldTransforms: [{ fieldPath: voteType === "up" ? "upvotes" : "downvotes", increment: { integerValue: 1 } }]
      }
    }]
  };
  try {
    await fetch(firestoreUrl("documents:commit"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    deleteImageCache(mediaId);
  } catch (e) {
    console.error("ZeroSlop: Image vote failed", e);
  }
}

/** Keep this computer's results so posts are re-labelled after a refresh. */
async function saveImageResultLocally(msg) {
  const { imageCheckCache = {} } = await chrome.storage.local.get(["imageCheckCache"]);
  imageCheckCache[msg.mediaId] = {
    score: msg.result.score,
    kind: msg.kind || "image",
    model: msg.result.model || DETECTOR_MODEL,
    framesChecked: msg.result.framesChecked || 1,
    tweetId: msg.tweetId || null,
    checkedAt: Date.now()
  };
  const ids = Object.keys(imageCheckCache);
  if (ids.length > IMAGE_CACHE_LIMIT) {
    ids.sort((a, b) => imageCheckCache[a].checkedAt - imageCheckCache[b].checkedAt)
      .slice(0, ids.length - IMAGE_CACHE_LIMIT)
      .forEach((id) => delete imageCheckCache[id]);
  }
  await chrome.storage.local.set({ imageCheckCache });
}

async function handleImageDetectResult(msg) {
  // Include this check in the community numbers shown on the result card.
  const before = (await getImageRegistry([msg.mediaId], { fresh: true }))[msg.mediaId];
  const checks = (before?.checks || 0) + 1;
  const avg = Math.round(((before?.scoreSum || 0) + msg.result.score) / checks);
  const community = { checks, avg, upvotes: before?.upvotes || 0, downvotes: before?.downvotes || 0 };

  await saveImageResultLocally(msg);
  chrome.tabs.sendMessage(msg.tabId, {
    action: "imageDetectResult", requestId: msg.requestId, tweetId: msg.tweetId, url: msg.url,
    mediaId: msg.mediaId, kind: msg.kind, result: msg.result, community
  }).catch(() => {});

  await storeImageResult(msg);
  setImageCache(msg.mediaId, { data: { ...community, scoreSum: (before?.scoreSum || 0) + msg.result.score, kind: msg.kind, model: msg.result.model }, timestamp: Date.now() });
}

async function startImageCheck(tabId, requestId, url, tweetId, modelReady) {
  chrome.tabs.sendMessage(tabId, { action: "imageCheckStatus", requestId, tweetId, stage: modelReady ? "loading" : "starting", size: IMAGE_MODEL_SIZE });
  try {
    await ensureOffscreenDocument();
    await sendToOffscreen({ type: "checkImage", requestId, tabId, url, tweetId });
  } catch (e) {
    console.error("ZeroSlop: Could not start the image model", e);
    chrome.tabs.sendMessage(tabId, { action: "imageCheckError", requestId, tweetId, code: "failed", message: "The image model couldn’t start." });
  }
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length > 0) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Runs the on-device AI image check with WebGPU."
    });
  } catch (e) {
    if (!String(e?.message || e).includes("single offscreen")) throw e;
  }
}

async function sendToOffscreen(message) {
  // The offscreen page needs a moment to load its module before it can receive messages.
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await chrome.runtime.sendMessage({ target: "offscreen", ...message });
      return;
    } catch (e) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("The offscreen image model did not respond.");
}

// Messages from the offscreen model page and from the image-check card on the page.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === "background") {
    if (msg.type === "detectorReady") {
      chrome.storage.local.set({ detectorReady: true });
      return;
    }
    if (msg.type === "imageDetectResult" && msg.tabId && validMediaId(msg.mediaId)) {
      handleImageDetectResult(msg);
      return;
    }
    if (msg.type === "modelReady") {
      const update = { imageModelReady: true, imageModelConsent: true };
      if (msg.dtype) update.imageModelDtype = msg.dtype;
      chrome.storage.local.set(update);
      chrome.storage.local.remove("imageModelDownload");
    } else if (msg.type === "modelProgress") {
      // Shown by the popup's image-check section, even after the popup was closed and reopened.
      chrome.storage.local.set({ imageModelDownload: { stage: msg.stage, progress: msg.progress ?? 0, loaded: msg.loaded ?? 0, total: msg.total ?? 0, updatedAt: Date.now() } });
    } else if (msg.type === "modelError") {
      chrome.storage.local.set({ imageModelDownload: { stage: "error", code: msg.code, message: msg.message, updatedAt: Date.now() } });
    } else if (msg.type === "offscreenIdle") {
      chrome.offscreen.closeDocument().catch(() => {});
    } else if (["imageCheckStatus", "imageCheckResult", "imageCheckError"].includes(msg.type) && msg.tabId) {
      const { target, type, ...rest } = msg;
      chrome.tabs.sendMessage(msg.tabId, { ...rest, action: type, size: IMAGE_MODEL_SIZE }).catch(() => {});
    }
    return;
  }
  if (msg?.action === "downloadImageModel") {
    // From the popup: download the model now instead of on the first image check.
    chrome.storage.local.set({ imageModelConsent: true, imageModelDownload: { stage: "starting", progress: 0, updatedAt: Date.now() } });
    ensureOffscreenDocument()
      .then(() => sendToOffscreen({ type: "preloadModel" }))
      .catch((e) => {
        console.error("ZeroSlop: Could not start the model download", e);
        chrome.storage.local.set({ imageModelDownload: { stage: "error", code: "failed", message: "The image model couldn’t start.", updatedAt: Date.now() } });
      });
    return;
  }
  if (msg?.action === "removeImageModel") {
    // From the popup: unload the model so the deleted files aren't still held in memory.
    chrome.offscreen.closeDocument().catch(() => {});
    chrome.storage.local.remove("imageModelDownload");
    return;
  }
  if (msg?.action === "detectMedia" && sender.tab) {
    requestImageDetect(sender.tab.id, msg.media, msg.requestId);
    return;
  }
  if (msg?.action === "zerogptScore") {
    scoreTextWithZeroGPT(msg.text || "", { tweetId: msg.tweetId, author: msg.author }).then(sendResponse);
    return true;
  }
  if (msg?.action === "queueSlopActions" && sender.tab) {
    queueSlopActions(msg.batchId, msg.actions || [], sender.tab.id);
    return;
  }
  if (msg?.action === "cancelSlopActions") {
    sendResponse({ cancelled: cancelSlopActions(msg.batchId) });
    return true;
  }
  if (msg?.action === "checkImageRegistry") {
    getImageRegistry(msg.mediaIds || []).then((entries) => sendResponse(entries)).catch(() => sendResponse({}));
    return true;
  }
  if (msg?.action === "voteImage") {
    voteImage(msg.mediaId, msg.voteType);
    return;
  }
  if (msg?.action === "explainImage" && sender.tab) {
    // Clicking "Explain (3.4 GB download)" is the consent to download Gemma.
    chrome.storage.local.get(["imageModelReady"]).then(({ imageModelReady }) => {
      chrome.storage.local.set({ imageModelConsent: true });
      startImageCheck(sender.tab.id, crypto.randomUUID(), msg.url, msg.tweetId || null, !!imageModelReady);
    });
    return;
  }
});

function handleManualReport(request, tabId) {
  const score = request.aiScore || 0;
  // Account-only reports have no post to store.
  if (request.tweetId && !String(request.tweetId).startsWith('local-')) {
    storeSlopTweet(request.tweetId, request.text, score, request.author, true, request.slopType, request.extractionResults);
  }

  if (request.shieldType && request.author) {
    storeSlopFactoryReport(request.author, request.shieldType);

    const action = SHIELD_ACTIONS[request.shieldType.replace('shield-', '')];
    if (action && tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: action,
        handle: request.author.handle
      }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// "Is this slop?" answers from the panel, sent after a short undo window
// ---------------------------------------------------------------------------

const UNDO_WINDOW_MS = 5000;
const pendingSlopActions = new Map(); // batchId -> timer

function queueSlopActions(batchId, actions, tabId) {
  clearTimeout(pendingSlopActions.get(batchId));
  pendingSlopActions.set(batchId, setTimeout(() => {
    pendingSlopActions.delete(batchId);
    for (const a of actions) runSlopAction(a, tabId);
  }, UNDO_WINDOW_MS));
}

function cancelSlopActions(batchId) {
  clearTimeout(pendingSlopActions.get(batchId));
  return pendingSlopActions.delete(batchId);
}

function runSlopAction(a, tabId) {
  switch (a.type) {
    case "reportPost":
      handleManualReport({ ...a, action: "manualReport" }, tabId);
      if (a.findAmplifiers && a.tweetId) scanAmplifiers(a.tweetId);
      break;
    case "votePost":
      voteSlopTweet(a.tweetId, a.voteType);
      break;
    case "reportAccount":
      handleManualReport({ tweetId: null, author: a.author, shieldType: a.shieldType }, tabId);
      break;
    case "voteAccount":
      voteSlopAccount(a.handle, a.voteType);
      break;
    case "markImage":
      markImage(a);
      break;
  }
}

/** Record a person's "slop / not slop" answer on an image, alongside its detector score. */
async function markImage({ mediaId, url, kind, score, tweetId, author, verdict }) {
  if (!validMediaId(mediaId) || typeof score !== "number") return;
  const fields = {
    media_id: { stringValue: mediaId },
    media_url: { stringValue: url || "" },
    kind: { stringValue: kind || "image" },
    ai_score: { doubleValue: score },
    last_marked: { timestampValue: new Date().toISOString() }
  };
  if (tweetId) fields.tweet_id = { stringValue: tweetId };
  if (author) fields.author_handle = { stringValue: author };
  const name = firestoreDoc(`image_registry/${mediaId}`);
  const body = {
    writes: [
      { update: { name, fields }, updateMask: { fieldPaths: Object.keys(fields) } },
      { transform: { document: name, fieldTransforms: [{ fieldPath: verdict === "slop" ? "marked_slop" : "marked_not_slop", increment: { integerValue: 1 } }] } }
    ]
  };
  try {
    await fetch(firestoreUrl("documents:commit"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    imageRegistryCache.delete(mediaId);
  } catch (e) {
    console.error("ZeroSlop: Image mark failed", e);
  }
}

// Account shield type -> content-script message that labels the account
const SHIELD_ACTIONS = {
  red: "showSlopFactoryWarning",
  blue: "showHighAIWarning",
  green: "showOrganicSuccess"
};

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "autoScanTweet") {
    chrome.storage.local.get(['autoScan', 'adminOrganicCollection'], (result) => {
      if (result.autoScan || result.adminOrganicCollection) {
        console.log(`ZeroSlop: Auto-scan tweet ${request.tweetId} (admin mode: ${result.adminOrganicCollection})`);
        performDetection(request.text, sender.tab.id, request.tweetId, true, request.author, false, result.adminOrganicCollection);
      }
    });
  } else if (request.action === "checkRegistry") {
    // Layer 1: Community Shield - always check registry (free)
    checkRegistry(request.tweetId).then(data => {
      if (data) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "showResult",
          data: {
            fakePercentage: data.ai_score,
            feedback_message: "From ZeroSlop Registry",
            upvotes: data.upvotes,
            downvotes: data.downvotes
          },
          tweetId: request.tweetId,
          isAutoScan: true
        });
        sendResponse(data);
      } else {
        sendResponse(null);
      }
    });
    return true;
  } else if (request.action === "closeScanTab") {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id);
    }
  } else if (request.action === "manualReport") {
    handleManualReport(request, sender.tab?.id);
  } else if (request.action === "voteSlop") {
    voteSlopTweet(request.tweetId, request.voteType);
  } else if (request.action === "voteAccount") {
    voteSlopAccount(request.handle, request.voteType);
  } else if (request.action === "voteHuman") {
    console.log(`ZeroSlop: Received voteHuman action for tweet ${request.tweetId}, voteType: ${request.voteType}`);
    if (request.voteType === 'up') {
      console.log(`ZeroSlop: Calling storeHumanTweet for ${request.tweetId} with author ${request.author?.handle}`);
      storeHumanTweet(request.tweetId, request.text, request.author);
    }
    // Thumbs down: discard, do nothing
  } else if (request.action === "reportSuspicious") {
    storeSuspiciousAccount(request.handle, request.name, request.pfp, request.tweetId, request.factoryHandle);
  } else if (request.action === "manualReportAccount") {
    storeSlopFactoryReport(request.author);
    chrome.tabs.sendMessage(sender.tab.id, {
      action: "showSlopFactoryWarning",
      handle: request.author.handle
    });
  } else if (request.action === "checkSlopAccount") {
    checkSlopAccount(request.handle).then(data => {
      if (data) {
        // Accounts reported as general slop are stored with shield "none": no account label.
        const action = SHIELD_ACTIONS[data.shield_type];
        if (action) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: action,
            handle: request.handle
          });
        }
        sendResponse(data);
      } else {
        sendResponse(null);
      }
    });
    return true;
  } else if (request.action === "checkSuspicious") {
    checkSuspiciousAccount(request.handle).then(data => {
      if (data) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "showSuspiciousWarning",
          handle: request.handle,
          reasonTweetId: data.reason_tweet_id
        });
        sendResponse(data);
      } else {
        sendResponse(null);
      }
    });
    return true;
  } else if (request.action === "checkProfileSlop") {
    checkProfileSlop(request.handle).then(data => {
      // REQUIREMENT: Must have at least 3 high-slop detections to trigger the public warning banner
      if (data && data.highSlopCount >= 3) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "showProfileWarning",
          handle: request.handle,
          highSlopCount: data.highSlopCount,
          avgScore: data.avgScore
        });
        sendResponse(data);
      } else {
        sendResponse(null);
      }
    });
    return true;
  }
});

const accountKey = (handle) => handle.replace('@', '').toLowerCase();

// Run for every post that scrolls into view, so cached: found for 6 hours, not found for 2.
async function checkSlopAccount(handle) {
  const accountId = accountKey(handle);
  return cachedLookup(`acct_${accountId}`, async () => {
    const { found, doc } = await fetchFirestoreDoc(`slop_accounts/${accountId}`);
    if (!found) return { found: false };
    const fields = doc.fields || {};
    return {
      found: true,
      data: {
        handle: fields.handle?.stringValue,
        manual_reports: parseInt(fields.manual_reports?.integerValue || 0),
        shield_type: fields.shield_type?.stringValue || 'red'
      }
    };
  }, { foundTtl: 6 * HOUR, missingTtl: 2 * HOUR });
}

// Profile visits: one query per handle per hour.
async function checkProfileSlop(handle) {
  return cachedLookup(`prof_${accountKey(handle)}`, async () => {
    const url = firestoreUrl("documents:runQuery");
    const query = {
      structuredQuery: {
        from: [{ collectionId: "slop_registry" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "author_handle" },
            op: "EQUAL",
            value: { stringValue: handle }
          }
        }
      }
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query)
    });
    noteFirestoreResponse(response);
    if (!response.ok) throw new Error(`Firestore query failed: HTTP ${response.status}`);

    const results = await response.json();
    const docs = results.filter(r => r.document).map(r => r.document);
    const score = (doc) => doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0;
    const highSlopDocs = docs.filter(doc => score(doc) > 15);
    if (!highSlopDocs.length) return { found: false };
    const totalScore = docs.reduce((acc, doc) => acc + score(doc), 0);
    return {
      found: true,
      data: { highSlopCount: highSlopDocs.length, avgScore: Math.round(totalScore / docs.length) }
    };
  }, { foundTtl: HOUR, missingTtl: HOUR });
}

function incrementSlopsCaught() {
  chrome.storage.local.get(['slopsCaught'], (result) => {
    const current = result.slopsCaught || 0;
    chrome.storage.local.set({ slopsCaught: current + 1 });
  });
}

// Run for every post that scrolls into view, so cached: found for 24 hours, not found for 1.
async function checkRegistry(tweetId) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(tweetId))) return null;
  return cachedLookup(`cache_${tweetId}`, async () => {
    const { found, doc } = await fetchFirestoreDoc(`slop_registry/${tweetId}`);
    if (!found) return { found: false };
    const fields = doc.fields || {};
    return {
      found: true,
      data: {
        ai_score: fields.ai_score?.doubleValue || fields.ai_score?.integerValue || 0,
        status: fields.status?.stringValue,
        upvotes: parseInt(fields.upvotes?.integerValue || 0),
        downvotes: parseInt(fields.downvotes?.integerValue || 0),
        author_handle: fields.author_handle?.stringValue
      }
    };
  }, { foundTtl: 24 * HOUR, missingTtl: HOUR });
}

async function storeSlopFactoryReport(author, shieldType = 'shield-red') {
  const accountId = author.handle.replace('@', '').toLowerCase();
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit?key=${FIREBASE_CONFIG.apiKey}`;

  try {
    // Check if new account. If the read fails (e.g. quota exceeded), assume it exists, so a
    // failed read can't count it twice or overwrite its label.
    let isNew = false;
    try {
      isNew = !(await fetchFirestoreDoc(`slop_accounts/${accountId}`)).found;
    } catch (e) {}
    if (isNew) {
      updateGlobalStats('total_accounts');
    }

    // Prepare metadata
    const shield = shieldType === 'shield-red' ? 'red' : shieldType === 'shield-blue' ? 'blue' : shieldType === 'shield-green' ? 'green' : 'none';
    const fields = {
      handle: { stringValue: author.handle },
      name: { stringValue: author.name || "" },
      pfp: { stringValue: author.pfp || "" },
      last_reported: { timestampValue: new Date().toISOString() }
    };
    // A report that leaves the account unlabelled ("none") must not replace a label
    // someone else already gave it. Only new accounts get "none" written.
    if (shield !== 'none' || isNew) {
      fields.shield_type = { stringValue: shield };
    }

    // Prepare commit body for BOTH metadata update AND atomic increment
    const body = {
      writes: [
        {
          update: {
            name: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_accounts/${accountId}`,
            fields: fields
          },
          // Without a mask, Firestore replaces the whole document, wiping votes and
          // resetting manual_reports. The mask limits the write to these fields.
          updateMask: { fieldPaths: Object.keys(fields) }
        },
        {
          transform: {
            document: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_accounts/${accountId}`,
            fieldTransforms: [{
              fieldPath: "manual_reports",
              increment: { integerValue: 1 }
            }]          }
        }
      ]
    };

    const response = await fetch(commitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (response.ok) {
      forgetLookup(`acct_${accountId}`);
      console.log(`ZeroSlop: Successfully reported ${shieldType} ${author.handle}`);
      if (shieldType !== 'shield-green') {
        // Increment global slop count for the report
        updateGlobalStats('total_slops');
        incrementSlopsCaught();
      }
    }
  } catch (e) {
    console.error("ZeroSlop: Error reporting slop factory (atomic)", e);
  }
}

/**
 * Score text with ZeroGPT for the panel. Returns { score, words } or { error }.
 * Like the old right-click scan, results go to the scan history and the registry.
 */
async function scoreTextWithZeroGPT(text, { tweetId = null, author = null } = {}) {
  const { zerogptApiKey } = await chrome.storage.local.get(['zerogptApiKey']);
  if (!zerogptApiKey) return { error: "no-key" };
  try {
    const response = await fetch("https://api.zerogpt.com/api/detect/detectText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "ApiKey": zerogptApiKey },
      body: JSON.stringify({ input_text: text })
    });
    if (!response.ok) return { error: "failed", status: response.status };
    const result = await response.json();
    if (!result.success) return { error: "failed" };
    const score = Math.round(result.data.fakePercentage || 0);
    saveToHistory(text, score, result.data.textWords);
    if (score > 15) {
      incrementSlopsCaught();
      updateGlobalStats('total_slops');
    }
    if (tweetId) storeSlopTweet(tweetId, text, score, author, false);
    return { score, words: result.data.textWords || 0 };
  } catch (e) {
    console.error("ZeroSlop: ZeroGPT request failed", e);
    return { error: "failed" };
  }
}

async function performDetection(text, tabId, tweetId = null, isAutoScan = false, author = null, isThread = false, isAdminMode = false) {
  const { zerogptApiKey } = await chrome.storage.local.get(['zerogptApiKey']);
  if (!zerogptApiKey) {
    if (!isAutoScan) {
      chrome.tabs.sendMessage(tabId, {
        action: "showError",
        message: "API Key is missing! Please set it in the extension popup."
      });
    }
    return;
  }

  if (!isAutoScan) chrome.tabs.sendMessage(tabId, { action: "showLoader" });

  try {
    const response = await fetch("https://api.zerogpt.com/api/detect/detectText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "ApiKey": zerogptApiKey },
      body: JSON.stringify({ input_text: text })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        const percentage = result.data.fakePercentage || 0;
        saveToHistory(text, percentage, result.data.textWords);

        if (percentage > 15) {
          incrementSlopsCaught();
          updateGlobalStats('total_slops');
        }

        if (tweetId) {
          storeSlopTweet(tweetId, text, percentage, author, false);
        }

        // Admin mode: send different message for badge injection
        if (isAdminMode) {
          console.log(`ZeroSlop Admin: Sending badge message for tweet ${tweetId} at ${percentage}%`);
          chrome.tabs.sendMessage(tabId, {
            action: "adminShowBadge",
            data: {
              percentage: percentage,
              tweetId: tweetId,
              author: author
            },
            isAutoScan: isAutoScan
          });
        } else {
          chrome.tabs.sendMessage(tabId, {
            action: "showResult",
            data: {
              ...result.data,
              feedback_message: isThread ? `Thread Analysis: ${result.data.feedback_message || "Analyzed"}` : result.data.feedback_message,
              upvotes: 0,
              downvotes: 0
            },
            tweetId: tweetId,
            isAutoScan: isAutoScan
          });
        }
      }
    }
  } catch (error) {
    console.error("ZeroSlop: Fetch error:", error);
  }
}

async function updateDailyTrend() {
  const dateStr = new Date().toISOString().split('T')[0];
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit?key=${FIREBASE_CONFIG.apiKey}`;

  const body = {
    writes: [{
      transform: {
        document: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/stats/global`,
        fieldTransforms: [{
          fieldPath: `daily_stats.\`${dateStr}\``,
          increment: { integerValue: 1 }
        }, {
          fieldPath: "last_updated",
          setToServerValue: "REQUEST_TIME"
        }]
      }
    }]
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.text();
      console.error(`ZeroSlop: Daily trend update failed: ${err}`);
    } else {
      console.log(`ZeroSlop: Successfully updated daily trend for ${dateStr}`);
    }
  } catch (e) {
    console.error("ZeroSlop: Error updating daily trend (atomic)", e);
  }
}

async function updateGlobalStats(fieldName = 'total_slops') {
  if (fieldName === 'total_slops') {
    updateDailyTrend();
  }
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit?key=${FIREBASE_CONFIG.apiKey}`;

  const body = {
    writes: [{
      transform: {
        document: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/stats/global`,
        fieldTransforms: [{
          fieldPath: fieldName,
          increment: { integerValue: 1 }
        }, {
          fieldPath: "last_updated",
          setToServerValue: "REQUEST_TIME"
        }]      }
    }]
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (response.ok) {
      console.log(`ZeroSlop: Atomically updated global stats: ${fieldName}`);
    } else {
      const err = await response.text();
      console.error(`ZeroSlop: Global stats update failed: ${err}`);
    }
  } catch (e) {
    console.error(`ZeroSlop: Error updating global stats for ${fieldName} (atomic)`, e);
  }
}

async function storeSlopTweet(tweetId, text, percentage, author, isManual = false, slopType = null, extractionResults = null) {
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit?key=${FIREBASE_CONFIG.apiKey}`;
  
  const fields = {
    tweet_id: { stringValue: tweetId },
    text: { stringValue: text?.substring(0, 1000) || "" },
    status: { stringValue: "pending" },
    last_updated: { timestampValue: new Date().toISOString() }
  };

  if (slopType) fields.slop_type = { stringValue: slopType };
  if (extractionResults) {
    fields.test_accountability = { booleanValue: !!extractionResults.accountability };
    fields.test_funnel = { booleanValue: !!extractionResults.funnel };
    fields.test_replicability = { booleanValue: !!extractionResults.replicability };
  }

  const isSlop = (percentage > 15 || isManual) && slopType !== 'type_organic_human';

  if (percentage > 0 && slopType !== 'type_organic_human') {
    fields.ai_score = { doubleValue: parseFloat(percentage) };
    if (percentage > 15) {
      incrementSlopsCaught();
      updateGlobalStats('total_slops');
    }
  } else if (isManual && slopType !== 'type_organic_human') {
    incrementSlopsCaught();
    updateGlobalStats('total_slops');
  }

  if (isManual) fields.manual_report = { booleanValue: true };
  
  if (author) {
    if (author.name) fields.author_name = { stringValue: author.name };
    if (author.handle) fields.author_handle = { stringValue: author.handle };
    if (author.pfp) fields.author_pfp = { stringValue: author.pfp };
  }

  // Use Commit API for robust UPSERT
  const body = {
    writes: [{
      update: {
        name: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_registry/${tweetId}`,
        fields: fields
      },
      // Only write these fields. Without a mask Firestore replaces the whole document,
      // wiping votes and anything this report doesn't include.
      updateMask: { fieldPaths: Object.keys(fields) }
    }]
  };

  try {
    const response = await fetch(commitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    
    if (response.ok) {
      console.log(`ZeroSlop: Successfully stored slop tweet ${tweetId}`);
      forgetLookup(`cache_${tweetId}`);
      
      // Track unique accounts if it's slop
      if (author && author.handle && isSlop) {
        const accountId = author.handle.replace('@', '').toLowerCase();
        // Check and report account if new
        checkSlopAccount(author.handle).then(data => {
          if (!data) {
            storeSlopFactoryReport(author, 'shield-none'); // Record discovery
          }
        });
      }
    } else {
      const err = await response.text();
      console.error(`ZeroSlop: Commit failed for tweet: ${err}`);
    }
  } catch (e) {
    console.error("ZeroSlop: Network error during commit:", e);
  }
}

async function storeHumanTweet(tweetId, text, author) {
  console.log(`ZeroSlop: storeHumanTweet called with tweetId=${tweetId}, text length=${text?.length}, author=${author?.handle}`);
  
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit?key=${FIREBASE_CONFIG.apiKey}`;

  const fields = {
    tweet_id: { stringValue: tweetId },
    text: { stringValue: text?.substring(0, 1000) || "" },
    status: { stringValue: "verified_human" },
    label: { stringValue: "organic-human" },
    last_updated: { timestampValue: new Date().toISOString() }
  };

  if (author) {
    if (author.name) fields.author_name = { stringValue: author.name };
    if (author.handle) fields.author_handle = { stringValue: author.handle };
    if (author.pfp) fields.author_pfp = { stringValue: author.pfp };
  }

  console.log(`ZeroSlop: Firestore commit payload:`, JSON.stringify({tweetId, fields}, null, 2));

  const body = {
    writes: [{
      update: {
        name: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/human_registry/${tweetId}`,
        fields: fields
      },
      // Only write these fields. Without a mask Firestore replaces the whole document,
      // wiping votes and anything this report doesn't include.
      updateMask: { fieldPaths: Object.keys(fields) }
    }]
  };

  try {
    console.log(`ZeroSlop: Sending commit request to Firestore...`);
    const response = await fetch(commitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    console.log(`ZeroSlop: Firestore response status: ${response.status}`);
    if (response.ok) {
      console.log(`ZeroSlop: Successfully stored human tweet ${tweetId}`);
    } else {
      const err = await response.text();
      console.error(`ZeroSlop: Commit failed for human tweet: ${err}`);
    }
  } catch (e) {
    console.error("ZeroSlop: Network error during human tweet commit:", e);
  }
}

async function voteSlopAccount(handle, voteType) {
  const accountId = handle.replace('@', '').toLowerCase();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit?key=${FIREBASE_CONFIG.apiKey}`;
  
  const fieldName = voteType === 'up' ? 'upvotes' : 'downvotes';
  const body = {
    writes: [{
      transform: {
        document: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_accounts/${accountId}`,
        fieldTransforms: [{
          fieldPath: fieldName,
          increment: { integerValue: 1 }
        }]
      }
    }]
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    forgetLookup(`acct_${accountId}`);
  } catch (e) {
    console.error("ZeroSlop: Error voting for account (atomic)", e);
  }
}

async function voteSlopTweet(tweetId, voteType) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit?key=${FIREBASE_CONFIG.apiKey}`;
  
  const fieldName = voteType === 'up' ? 'upvotes' : 'downvotes';
  const body = {
    writes: [{
      transform: {
        document: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_registry/${tweetId}`,
        fieldTransforms: [{
          fieldPath: fieldName,
          increment: { integerValue: 1 }
        }]
      }
    }]
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    forgetLookup(`cache_${tweetId}`);
  } catch (e) {
    console.error("ZeroSlop: Error voting for tweet (atomic)", e);
  }
}

function saveToHistory(text, percentage, words) {
  chrome.storage.local.get(['scanHistory'], (result) => {
    let history = result.scanHistory || [];
    history.push({
      timestamp: new Date().toISOString(),
      text: text.substring(0, 200),
      percentage: percentage || 0,
      words: words || 0
    });
    if (history.length > 50) history = history.slice(-50);
    chrome.storage.local.set({ scanHistory: history });
  });
}

async function storeSuspiciousAccount(handle, name, pfp, tweetId, factoryHandle = null) {
  const accountId = handle.replace('@', '').toLowerCase();
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:commit?key=${FIREBASE_CONFIG.apiKey}`;

  // Every bot amplifier is a slop detection event
  updateGlobalStats('total_slops');
  incrementSlopsCaught();

  const fields = {
    handle: { stringValue: handle },
    name: { stringValue: name || "" },
    pfp: { stringValue: pfp || "" },
    reason_tweet_id: { stringValue: tweetId || "" },
    detected_at: { timestampValue: new Date().toISOString() }
  };

  if (factoryHandle) {
    fields.factory_handle = { stringValue: factoryHandle };
  }

  const body = {
    writes: [{
      update: {
        name: `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/suspicious_accounts/${accountId}`,
        fields: fields
      },
      // Only write these fields. Without a mask Firestore replaces the whole document,
      // wiping votes and anything this report doesn't include.
      updateMask: { fieldPaths: Object.keys(fields) }
    }]
  };

  try {
    const response = await fetch(commitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (response.ok) {
      console.log(`ZeroSlop: Successfully stored suspicious account ${handle}`);
      forgetLookup(`susp_${accountId}`);
    } else {
      const err = await response.text();
      console.error(`ZeroSlop: Commit failed for suspicious: ${err}`);
    }
  } catch (e) {
    console.error("ZeroSlop: Error storing suspicious account", e);
  }
}

// Run for every post that scrolls into view, so cached: found for 6 hours, not found for 2.
async function checkSuspiciousAccount(handle) {
  const accountId = accountKey(handle);
  return cachedLookup(`susp_${accountId}`, async () => {
    const { found, doc } = await fetchFirestoreDoc(`suspicious_accounts/${accountId}`);
    if (!found) return { found: false };
    return { found: true, data: { reason_tweet_id: doc.fields?.reason_tweet_id?.stringValue } };
  }, { foundTtl: 6 * HOUR, missingTtl: 2 * HOUR });
}
