# Privacy Policy for ZeroSlop

**Last Updated:** March 22, 2026

ZeroSlop is committed to protecting your privacy. This Privacy Policy explains how we handle your data when you use the ZeroSlop Chrome Extension and participate in the Community Registry.

## 1. Information We Collect
ZeroSlop is designed with a "privacy-first" approach. We minimize data collection and prioritize local storage.

### 1.1. Data Stored Locally
The following information is stored **locally** on your device using your browser's secure storage:
*   **ZeroGPT API Key:** Provided by you to enable the AI detection service.
*   **Local Scan History:** A record of the tweets you have scanned and their detection scores.
*   **Settings:** Your preferences (Auto-Scan, Hunter Vision, Thresholds).

### 1.2. Community Registry (Public Data)
When you use the **"Report as AI Slop"** or **"Mark as Slop Factory"** features, or when **Auto-Scan** detects high-confidence slop, the following anonymized metadata is sent to the **ZeroSlop Registry** (hosted on Firebase/Firestore):
*   **Tweet ID & Text:** The content identified as slop.
*   **AI Score:** The detection percentage from the ZeroGPT API.
*   **Author Metadata:** Public handle, display name, and profile picture of the account producing the slop.
*   **Reporting Metadata:** Timestamp and the specific "Dimension of Slop" category (e.g., Burnout Exploit).

**Note:** This data is public and used to build the community-powered network map and registry. No personally identifiable information (PII) about *you* (the reporter) is collected or stored in this process.

### 1.3. Data in Transit
When performing a scan, tweet text is sent over a secure connection (HTTPS) to:
*   **ZeroGPT Business API** (api.zerogpt.com): For neural curvature analysis.
*   **ZeroSlop Registry** (firestore.googleapis.com): For community verification and global stats.

## 2. How We Use Your Information
We use the information described above solely to:
*   Identify and categorize industrial-scale AI slop on X (Twitter).
*   Maintain a community-verified registry of slop factories and bot networks.
*   Provide real-time "Red Shield" warnings to other users.
*   Anonymously aggregate global trends for research and safety improvements.

## 3. Data Sharing and Disclosure
*   **Open Registry:** The slop data (tweet content and author handles) is public by design to help researchers and users identify bot networks.
*   **No PII Sharing:** We never collect, sell, or share your personal browsing history, IP address, or identity.
*   **No Third-Party Ads:** ZeroSlop is an open-source tool and does not include advertising or tracking pixels.

## 4. Your Control and Data Deletion
*   **Local Data:** You can clear your local history and API key at any time through the extension settings.
*   **Registry Data:** If you believe a tweet or account has been incorrectly added to the public registry, you can use the community **Downvote (👎)** system to flag it for review.
*   **Uninstall:** Uninstalling the extension removes all local data.

## 5. Contact
If you have any questions about this Privacy Policy, please contact us through the [ZeroSlop GitHub Repository](https://github.com/woodrock/zero-slop).

---
*ZeroSlop is an independent project and is not affiliated with Twitter (X) or ZeroGPT.com.*
