# ZeroSlop Smart Slop Guard - Tweet Thread

---

**Tweet 1/7**
🧵 Ever wondered how ZeroSlop's Smart Slop Guard catches AI slop WITHOUT using API credits?

Here's a deep dive into our local ML classifier that runs entirely in your browser 👇

#AI #MachineLearning #OpenSource

---

**Tweet 2/7**
🤖 What is it?

A **Multinomial Logistic Regression** classifier that sorts tweets into 3 buckets:

🚩 AI-Generated
🌿 Organic-Human  
⚠️ Slop Factory

No server calls. No tracking. All local.

---

**Tweet 3/7**
📊 Feature Engineering (1,007 total features)

**TF-IDF Text Features (1,000 dims)**
- Scans for 1,000 key terms
- Catches words like: "chatgpt", "prompts", "thread 🧵", "$10k/mo", "bookmark this"
- Weights rare, suspicious terms higher

---

**Tweet 4/7**
**Numerical Features (7 dims)**

1. AI Score (if available)
2. Text Length
3. Word Count
4. Avg Word Length
5. Exclamation Count!!!
6. Question Count???
7. Emoji Count 🤖

Slop factories LOVE exclamation marks and emojis. We track that.

---

**Tweet 5/7**
⚡ The Pipeline

Tweet Text
    ↓
TF-IDF Vectorizer (1,000 features)
    ↓
Feature Extractor (7 stats)
    ↓
Logistic Regression
    ↓
Softmax → Probability %
    ↓
Badge if >70% confidence

Takes ~5ms per tweet.

---

**Tweet 6/7**
🎯 Why Logistic Regression?

✅ Fast (runs in browser)
✅ Tiny (100 KB weights file)
✅ Interpretable (can inspect coefficients)
✅ Low memory
✅ Good enough for slop detection

Not a transformer. Doesn't need to be.

---

**Tweet 7/7**
🔧 Train it yourself!

All code is open-source. The Python script:
- Fetches from community registry
- Applies labeling rules
- Trains & exports weights
- Updates the extension

GitHub: github.com/woodrock/zero-slop

Keep the timeline human. 🛡️

---

## Alternative Shorter Version (4 tweets)

**Tweet 1/4**
🧵 How does ZeroSlop detect slop WITHOUT API credits?

Our Smart Slop Guard uses a local ML classifier:

📊 Multinomial Logistic Regression
🔤 1,000 TF-IDF text features  
📈 7 numerical features (text length, !!!, ???, emojis)
⚡ 5ms inference in browser

---

**Tweet 2/4**
3 Classes:

🚩 AI-Generated (AI score >15%)
🌿 Organic-Human (verified by users)
⚠️ Slop Factory (engagement farming patterns)

Catches patterns like:
- "N prompts to $10k"
- "Thread 🧵 bookmark this"
- "DM me for details"
- Excessive !!! and emojis

---

**Tweet 3/4**
Why not use a fancy transformer?

✅ Logistic Regression is:
- Fast (no lag on timeline)
- Tiny (100 KB vs GBs)
- Interpretable
- Privacy-first (no server calls)

Good enough > Perfect but slow

---

**Tweet 4/4**
🔧 Want to improve it?

The model retrains automatically from:
- Community reports
- Verified human tweets (admin mode)
- Heuristic labels

Every scan makes the free tier smarter.

GitHub: github.com/woodrock/zero-slop

---
