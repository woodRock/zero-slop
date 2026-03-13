# ZeroSlop: The Community-Powered AI Detection Shield 🛡️✨

![ZeroSlop Hero](docs/public/banner.jpg)

**ZeroSlop** is an open-source Chrome extension designed to identify and expose AI-generated "slop" on Twitter (X). Built with a community-first ethos, it turns detection into a collective effort to keep the timeline human.

[**Download Latest Version**](https://github.com/woodrock/zero-slop/raw/main/dist/zero-slop-extension.zip) | [**Official Website**](https://woodrock.github.io/zero-slop/)

---

## 🚀 Key Features

### 🧠 Community-Driven Registry
ZeroSlop is like **SponsorBlock for AI**. When one user scans a tweet, the result is saved to our shared community registry. As you scroll, AI score badges appear instantly for any tweet previously identified by the community—no extra API calls needed.

### 🧵 Specialized Scans
*   **Thread Detection:** Analyze entire conversational threads as a single block for maximum accuracy.
*   **Profile Analysis:** Expose "Slop Factories" by scanning an account's recent timeline activity collectively.

### 🛡️ Auto-Hide Slop
Tired of seeing bot replies? Enable **Auto-Hide** in your settings to automatically blur out any tweet that scores above your personal AI threshold (e.g., >85%). Click to reveal if you're curious!

### 🖼️ Wanted Posters
Expose the slop-posters with style. Generate a custom, high-impact "WANTED" poster for any detected slop and copy it to your clipboard with one click.

![Wanted Poster Demo](docs/public/zero-slop-wanted-posters.mov)

---

## 🛠️ How it Works

ZeroSlop combines the **ZeroGPT Business API** with a high-performance **Firestore Registry** to provide real-time protection.

![Architecture Diagram](docs/public/architecture-diagram.jpeg)

1.  **Detection:** Extension extracts tweet text and sends it to ZeroGPT.
2.  **Registry:** Detections are stored in a global community database.
3.  **Protection:** Other users see badges and auto-hiding based on community data.
4.  **Verification:** The community upvotes/downvotes detections to ensure registry accuracy.

---

## 📥 Installation

### Option 1: Direct Download (Recommended)
1.  [Download the extension ZIP](https://github.com/woodrock/zero-slop/raw/main/dist/zero-slop-extension.zip).
2.  Extract the ZIP file to a folder on your computer.
3.  Open `chrome://extensions/` in your browser.
4.  Enable **Developer mode** (top right toggle).
5.  Click **Load unpacked** and select the folder you just extracted.

### Option 2: Developers
```bash
git clone https://github.com/woodrock/zero-slop.git
```
Follow the manual installation steps above, selecting the cloned repository folder.

---

## 🪙 ZeroSlop Coin (CA)
Support the mission to clean up the timeline:
`CNuZoaZkeVTkcqxeXdeDWKcx9217AgvuqQz9xv5dpump`

---

## ⚖️ License
ZeroSlop is open-source and free forever. Built for a cleaner, more human internet. 🛡️✨
