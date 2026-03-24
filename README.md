# ZeroSlop: A Community-Powered Shield for X (Twitter)

ZeroSlop is an open-source browser extension and forensic platform designed to protect the human web from industrial-scale engagement farming and AI-generated "slop." 

In 2026, the algorithm doesn't just feed you; it harvests you. ZeroSlop gives you the tools to fight back, identifying the extraction funnels and bot networks that pollute your timeline.

## 🛡️ The Three-Shield System

ZeroSlop goes beyond binary AI detection. We categorize accounts based on their **intent** and **mechanics**:

- 🚩 **RED SHIELD: SLOP FACTORY**: Industrial engagement farms using coordinated bot networks and deceptive funnels (e.g., "N prompts to $10k") to capture your attention for monetization.
- 🔵 **BLUE SHIELD: HIGH AI USAGE**: Accounts that produce high-volume AI output but lack coordinated bot amplification or deceptive extraction hooks.
- ⚠️ **ORANGE SHIELD: SUSPICIOUS**: The "Faceless Army"—bot accounts caught retweeting, quoting, or amplifying confirmed Slop Factories.

## 🚀 Key Features

### 🕵️ Bounty Hunter Vision
- **Heuristic Highlighting**: Real-time, local scanning that highlights "Extraction Hooks" (Thread 🧵, "Save for later," "$0 to $10k") in red ink directly on your timeline.
- **Precision Reporting**: A multi-dimensional reporting drawer that lets you categorize slop types and perform the "Extraction Test" (Accountability, Funnel, Replicability).

### 🫰 Cinematic 'Zap' Mode
- Choose to **Blur** or **Zap** slop from your timeline.
- **The Snap**: When set to Zap, slop tweets disintegrate into ash with a cinematic horizontal-sweep "Thanos Snap" animation before being physically removed from the DOM.

### 🕸️ Forensic Slop Maps
- Deep-link from any **Red Shield** banner to the [ZeroSlop Registry](https://woodrock.github.io/zero-slop) to visualize the coordinated bot network behind the factory.
- Identify the connections between gurus and their synthetic amplification armies.

### 🧠 Community Registry & Analytics
- **Proof of Work**: Every report is verified by the community via 👍/👎 voting.
- **Daily Trends**: Track the global slop volume and the most active Slop Factories in real-time.
- **Research Access**: Our community-curated dataset is available for academic research to help build the next generation of AI safety tools.

## 🛠️ Technical Overview

ZeroSlop is built for performance and privacy:
- **ZeroGPT Business API**: Official, high-accuracy neural curvature analysis.
- **Firestore Commit API**: Robust, atomic concurrency handling for global statistics and voting.
- **Local Caching**: Reduces database reads by 90%, ensuring a smooth, low-latency browsing experience.
- **Privacy First**: Your API keys and browsing data stay in your local storage.

## 📥 Installation

### Chrome Web Store (Recommended)
**Coming soon!** Once approved, you can install directly from the [Chrome Web Store](https://chrome.google.com/webstore).

### Manual Installation (Development)
1. Clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `dist/` folder.

### Build from Source
```bash
# Install dependencies (optional, for testing)
npm install

# Create release package manually
cd dist
zip -r ../zero-slop-VERSION.zip manifest.json background.js content.js classifier.js popup.html popup.js model_weights.json icons/
```

## 📦 Chrome Web Store Submission

To submit a new version to the Chrome Web Store:

1. **Update version** in `manifest.json` and `package.json`
2. **Create ZIP package:**
   ```bash
   cd dist
   zip -r ../zero-slop-VERSION.zip manifest.json background.js content.js classifier.js popup.html popup.js model_weights.json icons/
   ```
3. **Upload** to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
4. **Deploy Firestore rules:**
   ```bash
   firebase deploy --only firestore:rules
   ```

### Required Store Assets
- **Promo images:** Small (440x280), Large (920x680)
- **Screenshots:** At least 1 (1280x800 recommended)
- **Privacy policy:** Use `PRIVACY.md` content

---

Keep the timeline human. **Join the hunt.** 🕵️🛡️🚩
[github.com/woodrock/zero-slop](https://github.com/woodrock/zero-slop)
