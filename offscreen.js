/*
 * ZeroSlop on-device image check.
 *
 * Runs in an offscreen document because the models need WebGPU and a long-lived page,
 * which neither the page's content script nor the background service worker provides.
 * Nothing is uploaded: images are fetched from X's CDN and analysed locally.
 *
 * Two models, both downloaded once and cached by transformers.js:
 *  - Detector (default): Community Forensics ViT, about 87 MB. One pass gives the probability
 *    an image is AI-generated, in well under a second.
 *  - Explainer (optional): Gemma 4 E2B, about 3.4 GB. Describes the signs it sees and reads watermarks.
 *
 * Detector messages: { target: 'offscreen', type: 'detectImage', requestId, tabId, url, frames, tweetId, mediaId, kind }
 *                    -> imageCheckStatus (mode 'detect') | imageDetectResult | imageCheckError
 *
 * Messages in:  { target: 'offscreen', type: 'checkImage', requestId, tabId, url, tweetId }
 *               { target: 'offscreen', type: 'preloadModel' }
 * Messages out: { target: 'background', type: 'imageCheckStatus' | 'imageCheckResult' | 'imageCheckError'
 *                 | 'modelProgress' | 'modelReady' | 'modelError' | 'offscreenIdle', ... }
 */

import {
  env, AutoProcessor, AutoImageProcessor, AutoModelForImageClassification, Gemma4ForConditionalGeneration, RawImage
} from './vendor/transformers.min.js';

const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';
// Trained on images from 4,800+ generators (Community Forensics, CVPR 2025). Single logit -> sigmoid = P(AI-generated).
// The full-precision export is used because the quantized ones can drift 10-70 points on unusual images.
const DETECTOR_ID = 'buildborderless/CommunityForensics-DeepfakeDet-ViT';
const IDLE_CLOSE_MS = 10 * 60 * 1000; // Free GPU memory after 10 idle minutes.

env.allowLocalModels = false;
env.useBrowserCache = true;
// Extensions can't load code from a CDN, so use the WebAssembly runtime bundled in vendor/ort/.
env.backends.onnx.wasm.wasmPaths = {
  mjs: chrome.runtime.getURL('vendor/ort/ort-wasm-simd-threaded.asyncify.mjs'),
  wasm: chrome.runtime.getURL('vendor/ort/ort-wasm-simd-threaded.asyncify.wasm')
};
env.backends.onnx.wasm.numThreads = 1;

const PROMPT = `You are checking an image from a post on X (Twitter) for a tool that flags AI-generated "slop".
The first image is the full picture. The second image, if present, is a close-up of its bottom edge, where AI watermarks usually appear.

Decide whether the picture was generated or heavily edited by AI. Look for:
- anatomy errors: hands, fingers, teeth, eyes, ears
- garbled, misspelled or nonsensical text and signs
- inconsistent lighting, shadows or reflections
- warped backgrounds, architecture or straight lines
- unnaturally smooth "plastic" skin or a glossy, over-polished look
- logos or watermarks of AI tools (for example Gemini, Sora, Grok, Meta AI, Midjourney, DALL-E, Firefly)
Also note if it is engagement bait, such as a text overlay promising money, prompts, tips or a "secret".

Reply with JSON only, no other text, in exactly this shape:
{"verdict": "likely_ai" | "unclear" | "likely_real", "confidence": 0-100, "signs": ["short phrase", "..."], "watermark": "tool name" | null, "bait": true | false}`;

let modelPromise = null;
let detectorPromise = null;
let queue = Promise.resolve();
let detectQueue = Promise.resolve(); // Separate, so quick checks don't wait behind a long explanation.
let idleTimer = null;
let activeJobs = 0;

// Close the page (freeing GPU memory) only when nothing has run for a while.
function jobStarted() {
  activeJobs++;
  clearTimeout(idleTimer);
}
function jobFinished() {
  activeJobs = Math.max(0, activeJobs - 1);
  if (activeJobs === 0) idleTimer = setTimeout(() => send({ type: 'offscreenIdle' }), IDLE_CLOSE_MS);
}
const progressListeners = new Set();

function send(msg) {
  chrome.runtime.sendMessage({ target: 'background', ...msg }).catch(() => {});
}

async function pickDtype() {
  if (!navigator.gpu) throw codedError('no-webgpu', 'WebGPU is not available in this browser.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw codedError('no-webgpu', 'No compatible GPU was found.');
  return adapter.features.has('shader-f16') ? 'q4f16' : 'q4';
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function hasWebGpu() {
  try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; }
}

function loadDetector(onProgress) {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      let downloading = false;
      const progress_callback = (info) => {
        if (info.status === 'download') downloading = true;
        if (info.status === 'progress_total') onProgress?.({ stage: downloading ? 'downloading' : 'loading', progress: info.progress, loaded: info.loaded, total: info.total });
      };
      // The detector is small enough to run on the CPU when WebGPU isn't available.
      const device = (await hasWebGpu()) ? 'webgpu' : 'wasm';
      const processor = await AutoImageProcessor.from_pretrained(DETECTOR_ID);
      const model = await AutoModelForImageClassification.from_pretrained(DETECTOR_ID, { dtype: 'fp32', device, progress_callback });
      send({ type: 'detectorReady', device });
      return { processor, model };
    })().catch((err) => {
      detectorPromise = null;
      throw err;
    });
  }
  return detectorPromise;
}

/**
 * The detector reads fine compression artifacts, so it works best on the least re-compressed copy X serves.
 * In testing, extra JPEG compression pulled an AI image's score from 100% down to 15-40%.
 * Try X's original upload first, then the large and requested sizes.
 */
function cdnVariants(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'pbs.twimg.com' || !u.searchParams.has('name')) return [url];
    const variants = ['orig', 'large'].map((name) => { u.searchParams.set('name', name); return u.href; });
    return [...new Set([...variants, url])];
  } catch (e) {
    return [url];
  }
}

async function loadBestImage(url) {
  for (const candidate of cdnVariants(url)) {
    try { return await RawImage.fromURL(candidate); } catch (e) { /* Try the next size. */ }
  }
  throw codedError('image-fetch', 'The image couldn’t be loaded.');
}

async function probabilityAI({ processor, model }, image) {
  const inputs = await processor(image);
  const { logits } = await model(inputs);
  const logit = Number(logits.data[0]);
  return 1 / (1 + Math.exp(-logit));
}

async function detectImage({ requestId, tabId, url, frames = [], tweetId, mediaId, kind }) {
  jobStarted();
  const status = (p) => send({ type: 'imageCheckStatus', mode: 'detect', requestId, tabId, tweetId, ...p });
  try {
    status({ stage: detectorPromise ? 'analyzing' : 'starting' });
    const detector = await loadDetector(status);
    status({ stage: 'analyzing' });

    const sources = [url, ...frames].filter(Boolean);
    const scores = [];
    for (const src of sources) {
      let image;
      try {
        image = src === url ? await loadBestImage(src) : await RawImage.fromURL(src);
      } catch (e) {
        if (src === url && sources.length === 1) throw codedError('image-fetch', 'The image couldn’t be loaded.');
        continue; // A frame that can't be read is skipped.
      }
      scores.push(await probabilityAI(detector, image));
    }
    if (!scores.length) throw codedError('image-fetch', 'The image couldn’t be loaded.');

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    send({
      type: 'imageDetectResult', requestId, tabId, tweetId, url, mediaId, kind,
      result: {
        score: Math.round(mean * 100),
        frameScores: scores.map((p) => Math.round(p * 100)),
        framesChecked: scores.length,
        model: DETECTOR_ID
      }
    });
  } catch (err) {
    console.error('ZeroSlop image detector failed', err);
    send({ type: 'imageCheckError', mode: 'detect', requestId, tabId, tweetId, code: err.code || 'failed', message: err.message || String(err) });
  } finally {
    jobFinished();
  }
}

function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const dtype = await pickDtype();
      let downloading = false;
      let lastReport = 0;
      const progress_callback = (info) => {
        if (info.status === 'download') downloading = true;
        if (info.status === 'progress_total') {
          const p = { stage: downloading ? 'downloading' : 'loading', progress: info.progress, loaded: info.loaded, total: info.total };
          progressListeners.forEach((fn) => fn(p));
          // Overall progress for the popup, throttled because it's saved to storage.
          const now = Date.now();
          if (now - lastReport > 500) {
            lastReport = now;
            send({ type: 'modelProgress', ...p });
          }
        }
      };
      send({ type: 'modelProgress', stage: 'starting', progress: 0 });
      const processor = await AutoProcessor.from_pretrained(MODEL_ID);
      const model = await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, { dtype, device: 'webgpu', progress_callback });
      send({ type: 'modelReady', dtype });
      return { processor, model };
    })().catch((err) => {
      modelPromise = null; // Allow a retry on the next request.
      send({ type: 'modelError', code: err.code || 'failed', message: err.message || String(err) });
      throw err;
    });
  }
  return modelPromise;
}

async function loadImages(url) {
  let image;
  try {
    image = await RawImage.fromURL(url);
  } catch (e) {
    throw codedError('image-fetch', 'The image couldn’t be loaded.');
  }
  const images = [image];
  // A close-up of the bottom strip makes small corner watermarks easier to spot.
  if (image.height >= 240 && image.width >= 240) {
    const top = Math.floor(image.height * 0.82);
    images.push(await image.crop([0, top, image.width - 1, image.height - 1]));
  }
  return images;
}

function parseAnswer(text) {
  const match = text.match(/\{[\s\S]*\}/);
  let data = {};
  if (match) {
    try { data = JSON.parse(match[0]); } catch (e) { data = {}; }
  }
  const verdicts = ['likely_ai', 'unclear', 'likely_real'];
  let verdict = verdicts.includes(data.verdict) ? data.verdict : null;
  if (!verdict) {
    const t = text.toLowerCase();
    verdict = t.includes('likely_ai') ? 'likely_ai' : t.includes('likely_real') ? 'likely_real' : 'unclear';
  }
  const confidence = Math.max(0, Math.min(100, Math.round(Number(data.confidence) || 0)));
  const signs = Array.isArray(data.signs)
    ? data.signs.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 120)).slice(0, 6)
    : [];
  const watermark = typeof data.watermark === 'string' && data.watermark.trim() && !/^(none|null|no)$/i.test(data.watermark.trim())
    ? data.watermark.trim().slice(0, 60)
    : null;
  return { verdict, confidence, signs, watermark, bait: data.bait === true, raw: match ? undefined : text.slice(0, 300) };
}

async function checkImage({ requestId, tabId, url, tweetId }, onProgress) {
  jobStarted();
  try {
    send({ type: 'imageCheckStatus', requestId, tabId, tweetId, stage: modelPromise ? 'loading' : 'starting' });
    const [{ processor, model }, images] = await Promise.all([loadModel(), loadImages(url)]);
    send({ type: 'imageCheckStatus', requestId, tabId, tweetId, stage: 'analyzing' });

    const messages = [{
      role: 'user',
      content: [...images.map(() => ({ type: 'image' })), { type: 'text', text: PROMPT }]
    }];
    const prompt = processor.apply_chat_template(messages, { enable_thinking: false, add_generation_prompt: true });
    const inputs = await processor(prompt, images, null, { add_special_tokens: false });
    const outputs = await model.generate({ ...inputs, max_new_tokens: 220, do_sample: false });
    const text = processor.batch_decode(outputs.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0] || '';

    send({ type: 'imageCheckResult', requestId, tabId, tweetId, url, result: parseAnswer(text) });
  } catch (err) {
    console.error('ZeroSlop image check failed', err);
    send({ type: 'imageCheckError', requestId, tabId, tweetId, code: err.code || 'failed', message: err.message || String(err) });
  } finally {
    progressListeners.delete(onProgress);
    jobFinished();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  sendResponse({ ok: true });
  if (msg.type === 'detectImage') {
    detectQueue = detectQueue.then(() => detectImage(msg));
  } else if (msg.type === 'checkImage') {
    // Show download progress right away, even while an earlier download or check is still running.
    const { requestId, tabId, tweetId } = msg;
    const onProgress = (p) => send({ type: 'imageCheckStatus', requestId, tabId, tweetId, ...p });
    progressListeners.add(onProgress);
    // One check at a time: they share the GPU.
    queue = queue.then(() => checkImage(msg, onProgress));
  } else if (msg.type === 'preloadModel') {
    // Download (or load) the model ahead of time, from the popup's "Download model" button.
    queue = queue.then(async () => {
      jobStarted();
      try {
        await loadModel();
        send({ type: 'modelReady' }); // Also report when it was already loaded.
      } catch (e) { /* Reported by loadModel via modelError. */ }
      jobFinished();
    });
  }
});
