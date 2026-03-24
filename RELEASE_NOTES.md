# Release Notes

## v1.4.1 (March 24, 2026)

### Critical Fixes
- **Layer Separation** - Fixed incorrect bundling of Layer 1 (Community Shield) and Layer 4 (Auto-Scan API)
  - Layer 1: Community Shield is now **enabled by default**, positioned first in settings (before Layer 2)
  - Layer 4: Auto-Scan with ZeroGPT API moved to Advanced Settings, after Slop Action & Threshold
  - Clear warning added for Layer 4: "Uses API Credits - Credits consumed quickly on active timelines"

### Labeling Rule Improvements
- **BREAKING Rule Refined** - Reduced false positives on genuine news commentary
  - Old: `/\bBREAKING\b/` (flagged all BREAKING posts)
  - New: `/\bBREAKING\b.{0,80}(free|prompts?|\$[\d,]+|replac|for free|tool|hack|secret|cheat)/`
  - Now catches: "BREAKING: Claude can replace your $500/hour lawyer for free" ✅
  - No longer flags: "Breaking: Apple published a paper" ❌

### Features (from v1.4.0)
- **Admin Mode for Data Collection** - Developer tool to collect organic-human labeled tweets via ZeroGPT API
- **Human Registry** - New Firestore collection (`human_registry`) for verified human tweets
- **Slop Factory Detection** - Admin badges now show different behavior for known slop factories (🚩 badge, adds to slop registry instead of human registry)
- **Smart Slop Guard Toggle Fix** - Toggle now properly shows/hides ML detection badges in real-time

### Technical
- Comprehensive logging for debugging admin mode flow
- Automatic badge removal when Smart Slop Guard is disabled
- Better error handling in Python training script for missing `human_registry` collection
- Firestore rules updated to allow reads on `human_registry` collection

### Files Changed
- `background.js` - Added `storeHumanTweet()`, admin mode detection, logging
- `content.js` - Added `injectHumanBadge()`, `injectLikelyAIBadge()`, slop factory detection
- `popup.html` / `popup.js` - Added admin toggle in advanced settings
- `python/sync_and_retrain.py` - Added `fetch_human_registry_data()`, dotenv support
- `firestore.rules` - Added `human_registry` rules

---

## v1.4.0 (March 2026)

### Features
- Community registry integration with Firestore
- Three-shield system (Red/Blue/Green)
- Cinematic Zap mode
- Forensic Slop Maps
- Smart Slop Guard with local ML model

---

## Submission Instructions

To submit a new version:

1. Update version in `manifest.json` and `package.json`
2. Create ZIP package:
   ```bash
   cd dist
   zip -r ../zero-slop-VERSION.zip manifest.json background.js content.js classifier.js popup.html popup.js model_weights.json icons/
   ```
3. Upload to Chrome Web Store Developer Dashboard
4. Deploy Firestore rules: `firebase deploy --only firestore:rules`
