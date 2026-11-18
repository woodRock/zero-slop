#!/usr/bin/env node
/*
 * Builds the loadable extension in dist/.
 *
 *   npm run build         copy sources and vendored runtime into dist/
 *   npm run build:watch   rebuild when a source file changes
 *
 * Vendored files come from node_modules (run `npm install --legacy-peer-deps` first):
 *   - transformers.js browser bundle (runs the on-device image model)
 *   - the matching ONNX Runtime WebAssembly files, because extensions can't load code from a CDN
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

const SOURCES = [
  'manifest.json',
  'background.js',
  'content.js',
  'classifier.js',
  'popup.html',
  'popup.js',
  'offscreen.html',
  'offscreen.js',
  'model_weights.json',
  'icons/icon.svg',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

// Find a package folder the way Node does: nearest node_modules first, then parent folders.
function resolvePackageDir(name, from = ROOT) {
  let dir = from;
  while (true) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Cannot find ${name}`);
    dir = parent;
  }
}

function vendorFiles() {
  const transformersDir = resolvePackageDir('@huggingface/transformers');
  // Use the onnxruntime-web that transformers.js itself depends on, so the WebAssembly matches its bundled JS.
  const ortDir = resolvePackageDir('onnxruntime-web', transformersDir);
  const ortName = 'ort-wasm-simd-threaded.asyncify';
  return [
    [path.join(transformersDir, 'dist/transformers.min.js'), 'vendor/transformers.min.js'],
    [path.join(transformersDir, 'LICENSE'), 'vendor/LICENSE-transformers.txt'],
    [path.join(ortDir, `dist/${ortName}.mjs`), `vendor/ort/${ortName}.mjs`],
    [path.join(ortDir, `dist/${ortName}.wasm`), `vendor/ort/${ortName}.wasm`],
  ];
}

function writeNotice(pkgDir, to) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const dest = path.join(DIST, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${pkg.name} ${pkg.version}\nLicense: ${pkg.license}\n${pkg.homepage || ''}\n`);
}

function copy(from, to) {
  const dest = path.join(DIST, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(from, dest);
}

function build() {
  for (const file of SOURCES) copy(path.join(ROOT, file), file);
  let vendored;
  try {
    vendored = vendorFiles();
  } catch (e) {
    console.error('Could not find vendored packages. Run `npm install --legacy-peer-deps` first.');
    process.exit(1);
  }
  for (const [from, to] of vendored) {
    if (!fs.existsSync(from)) {
      console.error(`Missing ${from}. Run \`npm install --legacy-peer-deps\` first.`);
      process.exit(1);
    }
    copy(from, to);
  }
  // onnxruntime-web ships without a LICENSE file, so record its licence from package.json.
  writeNotice(resolvePackageDir('onnxruntime-web', resolvePackageDir('@huggingface/transformers')), 'vendor/ort/NOTICE-onnxruntime.txt');
  console.log(`Built dist/ (${SOURCES.length} sources, ${vendored.length} vendored files).`);
}

build();

if (process.argv.includes('--watch')) {
  console.log('Watching for changes…');
  let timer = null;
  for (const file of SOURCES) {
    fs.watch(path.join(ROOT, file), () => {
      clearTimeout(timer);
      timer = setTimeout(build, 100);
    });
  }
}
