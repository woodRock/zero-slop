# ZeroSlop: The ZeroGPT Tweet Checker Chrome Extension

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=google-chrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)
![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)

🔍 Instantly detect AI-generated tweets on Twitter (X) using the ZeroGPT Business API.

## Installation

1.  Open Chrome and go to `chrome://extensions/`.
2.  Enable **Developer mode** in the top right corner.
3.  Click **Load unpacked**.
4.  Select the folder containing these files (`zero-slop`).

## Setup

1.  **Get an API Key:** 
    *   Create an account at [ZeroGPT.com](https://www.zerogpt.com/login).
    *   Navigate to your [Dashboard](https://www.zerogpt.com/dashboard).
    *   Go to the **API** section to generate your unique API Key.
2.  **Add Credits:** 
    *   **Important:** The ZeroGPT Business API is a paid service. You must add a balance or subscribe to a plan in your [ZeroGPT Account](https://www.zerogpt.com/dashboard) to use this extension. Without credits, the extension will return a "Not enough credits" error.
3.  **Configure the Extension:**
    *   Click on the extension icon in your Chrome toolbar.
    *   Paste your API Key into the popup.
    *   Click **Save API Key**.

## How to Use

1.  Go to [Twitter (X)](https://twitter.com).
2.  **Option 1:** Highlight text in a tweet, right-click, and select **Check with ZeroGPT**.
3.  **Option 2:** Right-click anywhere on a tweet (without selecting text) and select **Check with ZeroGPT**. The extension will automatically extract the text of that tweet.
4.  A result overlay will appear in the top-right corner of the page showing the detection percentage.

## Features

*   **High Accuracy:** Uses the official ZeroGPT Business API for enterprise-grade detection.
*   **Seamless Integration:** Native-feeling Twitter-style results.
*   **Maximum Visibility:** High z-index overlay that's always visible.
*   **Privacy First:** API key is stored locally in your browser.

## Testing

This project uses Jest for unit testing. To run tests locally:

1.  Install Node.js.
2.  Run `npm install`.
3.  Run `npm test`.

## API Note

This extension uses the ZeroGPT Business API endpoint: `https://api.zerogpt.com/api/detect/detectText`. Ensure your API key is valid for this endpoint.

## Support

If you'd like to support the development and maintenance of ZeroSlop, you can contribute to the following Contract Address (CA). This is entirely optional and only for those who wish to support the work:

`GY4453uGkG6QKbSU7YtduxhRqD4CETBaWr4qu5D3pump`
