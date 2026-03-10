// Initialize context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "checkZeroGPT",
    title: "Check with ZeroGPT",
    contexts: ["selection", "page", "link"],
    documentUrlPatterns: ["*://*.twitter.com/*", "*://*.x.com/*"]
  });
  console.log("ZeroGPT Extension: Context menu created.");
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "checkZeroGPT") {
    console.log("ZeroGPT Extension: Menu item clicked.");
    const textToCheck = info.selectionText;

    if (textToCheck) {
      performDetection(textToCheck, tab.id);
    } else {
      chrome.tabs.sendMessage(tab.id, { action: "getTweetText" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("ZeroGPT Extension: Message error:", chrome.runtime.lastError);
          return;
        }
        if (response && response.text) {
          performDetection(response.text, tab.id, response.tweetId);
        } else {
          showNotification(tab.id, "Could not find tweet text. Try selecting/highlighting the text manually and right-clicking again.");
        }
      });
    }
  }
});

// Handle messages from content script (like auto-scan requests)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "autoScanTweet") {
    chrome.storage.local.get(['autoScan'], (result) => {
      if (result.autoScan) {
        performDetection(request.text, sender.tab.id, request.tweetId, true);
      }
    });
  }
});

async function performDetection(text, tabId, tweetId = null, isAutoScan = false) {
  const { zerogptApiKey } = await chrome.storage.local.get(['zerogptApiKey']);

  if (!zerogptApiKey) {
    if (!isAutoScan) showNotification(tabId, "API Key is missing. Click the extension icon to set your key.");
    return;
  }

  if (!isAutoScan) chrome.tabs.sendMessage(tabId, { action: "showLoader" });

  try {
    const response = await fetch("https://api.zerogpt.com/api/detect/detectText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ApiKey": zerogptApiKey
      },
      body: JSON.stringify({ input_text: text })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ZeroGPT API Error Response:", errorText);
      if (!isAutoScan) showNotification(tabId, `API Error (${response.status}): ${errorText || "Server error"}`);
      return;
    }

    const result = await response.json();
    
    if (result.success) {
      // Save history
      saveToHistory(text, result.data.fakePercentage, result.data.textWords);
      
      chrome.tabs.sendMessage(tabId, {
        action: "showResult",
        data: result.data,
        tweetId: tweetId,
        isAutoScan: isAutoScan
      });
    } else {
      if (!isAutoScan) showNotification(tabId, result.message || "The API could not process this text.");
    }
  } catch (error) {
    console.error("ZeroGPT Extension: Fetch error:", error);
    if (!isAutoScan) showNotification(tabId, "Connection error. Please check your internet and API key validity.");
  }
}

function saveToHistory(text, percentage, words) {
  chrome.storage.local.get(['scanHistory'], (result) => {
    let history = result.scanHistory || [];
    history.push({
      timestamp: new Date().toISOString(),
      text: text.substring(0, 200), // Store up to 200 chars to save space
      percentage: percentage || 0,
      words: words || 0
    });
    // Keep only last 50 entries
    if (history.length > 50) history = history.slice(-50);
    chrome.storage.local.set({ scanHistory: history });
  });
}

function showNotification(tabId, message) {
  chrome.tabs.sendMessage(tabId, {
    action: "showError",
    message: message
  });
}