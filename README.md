# ZeroSlop: The Community-Powered AI Detection Shield 🛡️✨

![ZeroSlop Hero](docs/public/banner.jpg)

**ZeroSlop** is an open-source Chrome extension designed to identify and expose AI-generated "slop" on Twitter (X). Built with a community-first ethos, it turns detection into a collective effort to keep the timeline human.

[**Add to Chrome**](https://chromewebstore.google.com/detail/enlimjkhkfbhcoebopkklafhakhehiab?utm_source=item-share-cb) | [**Official Website**](https://woodrock.github.io/zero-slop/)

---

## 🚀 Key Features

### 🧠 Community-Driven Registry
ZeroSlop is like **SponsorBlock for AI**. When one user scans a tweet, the result is saved to our shared community registry. As you scroll, AI score badges appear instantly for any tweet previously identified by the community.

### 🧵 Specialized Scans
*   **Thread Detection:** Analyze entire conversational threads as a single block for maximum accuracy.
*   **Profile Analysis:** Expose "Slop Factories" by scanning an account's recent timeline activity collectively.

### 🛡️ Auto-Hide Slop
Tired of seeing bot replies? Enable **Auto-Hide** in your settings to automatically blur out any tweet that scores above your personal AI threshold.

### 🖼️ Wanted Posters
Expose the slop-posters with style. Generate a custom, high-impact "WANTED" poster for any detected slop and copy it to your clipboard with one click.

---

## 📸 See it in Action

### Instant Detection & Community Badges
![Detection Overlay](docs/public/zero-slop-result.png)
*Identify AI probability scores directly on your timeline.*

### Seamless Integration
![Context Menu](docs/public/zero-slop-right-click.png)
*Right-click any tweet, thread, or profile to start hunting.*

---

## 🛠️ How it Works

ZeroSlop combines the **ZeroGPT Business API** with a high-performance **Firestore Registry** to provide real-time protection.

![Architecture Diagram](docs/public/architecture-diagram.jpeg)

---

## 📥 Installation

Simply add ZeroSlop to your browser from the Chrome Web Store:

[**Add to Chrome**](https://chromewebstore.google.com/detail/enlimjkhkfbhcoebopkklafhakhehiab?utm_source=item-share-cb)

---

## 🔑 Configuration (Optional)

To perform new scans, you can add your own **ZeroGPT Business API Key**:

1. [**Get an API Key from ZeroGPT**](https://zerogpt.com) (Purchase credits as needed).
2. Open the ZeroSlop extension popup.
3. Paste your key into the **API Key** field and click **Save**.

*Note: Previously scanned tweets are cached in our Firestore Registry and can be viewed by all users for free.*

---

## 🪙 ZeroSlop Coin (CA)
Support the mission to clean up the timeline:
`CNuZoaZkeVTkcqxeXdeDWKcx9217AgvuqQz9xv5dpump`

---

## ⚖️ License
ZeroSlop is open-source and free forever. Built for a cleaner, more human internet. 🛡️✨
