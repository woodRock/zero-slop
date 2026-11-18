# Release Notes

## v1.5.0 (November 18, 2026)

### Calmer, clearer interface
- **No more page-wide banners.** Account warnings used to add a sticky banner every time a flagged account's post appeared in your timeline. Now they only appear on that account's own profile, once per session, and only the most important one. "Don't show again" is remembered for the session.
- **Verified humans no longer trigger an alert.** They get a quiet green label only.
- **One small label per post.** Coloured labels next to the timestamp replace the ALL-CAPS shield badges. When several signals apply, only the strongest one is shown. Click a label to see why it's there, vote on whether it's right, or open the network map.
- **Registry scores of 15% AI or less are no longer labelled** during automatic lookups. Posts you scan yourself always get a label.
- **New scan result card.** Shows a large score, a plain-language verdict and a meter, with a loading state, clear errors (including a missing API key), and the most likely action as the primary button. Report details sit in an optional disclosure.
- **Toasts replace `alert()` pop-ups** for confirmations and errors.
- **Hunter Vision highlights** underline bait phrases instead of recolouring the text, keep links and mentions intact, and prefer specific hooks such as "7 prompts" over long matches.
- **Blur and Hide are reversible.** Blurred posts show a "Show" button. Hidden posts collapse to a one-line note you can expand.
- **Matches X's light, dim and dark themes**, respects reduced-motion settings, and is keyboard accessible (Esc closes popovers and cards).

### Popup redesign
- A header shows protection status and your slop-caught count. The Stats tab has been removed.
- Plain-language settings replace the "Layer 1–4" jargon, and the long tutorial card moved into a collapsible "How it works" section.
- A segmented "When slop is found" control (Label only, Blur, Hide). The threshold slider only appears when it applies.
- New **Profile alerts** toggle.
- The deep-scan section has a show/hide toggle for the key and saves on Enter. Auto-scan stays disabled until a key is saved.
- History shows coloured scores and relative times, with a helpful empty state and a two-step "Clear history".

### Fixes
- Accounts reported as general slop (shield `none`) were displayed as slop factories. Reporting a post with "Leave the account unlabelled" no longer labels its author as a factory in the page.
- Profile header badges were sometimes added to the wrong profile.
- Hunter Vision regexes skipped matches because of a stale `lastIndex`.

---
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
