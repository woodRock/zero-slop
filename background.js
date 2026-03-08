// Initialize context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "checkZeroGPT",
    title: "Check with ZeroGPT",
    contexts: ["selection", "page", "link"]
  });
  console.log("ZeroGPT Extension: Context menu created.");
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "checkZeroGPT") {
    console.log("ZeroGPT Extension: Menu item clicked.");
    const textToCheck = info.selectionText;

    if (textToCheck) {
      console.log("ZeroGPT Extension: Selection text found.");
      performDetection(textToCheck, tab.id);
    } else {
      console.log("ZeroGPT Extension: No selection, asking content script for tweet text.");
      chrome.tabs.sendMessage(tab.id, { action: "getTweetText" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("ZeroGPT Extension: Message error:", chrome.runtime.lastError);
          // Likely script not injected yet, try to refresh or alert user
          return;
        }
        
        if (response && response.text) {
          console.log("ZeroGPT Extension: Content script returned text.");
          performDetection(response.text, tab.id);
        } else {
          console.log("ZeroGPT Extension: No text found by content script.");
          showNotification(tab.id, "Could not find tweet text. Try selecting/highlighting the text manually and right-clicking again.");
        }
      });
    }
  }
});

async function performDetection(text, tabId) {
  const { zerogptApiKey } = await chrome.storage.local.get(['zerogptApiKey']);

  if (!zerogptApiKey) {
    showNotification(tabId, "API Key is missing. Click the extension icon to set your key.");
    return;
  }

  chrome.tabs.sendMessage(tabId, { action: "showLoader" });

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
      showNotification(tabId, `API Error (${response.status}): ${errorText || "Server error"}`);
      return;
    }

    const result = await response.json();
    console.log("ZeroGPT API Result:", result);

    if (result.success) {
      chrome.tabs.sendMessage(tabId, {
        action: "showResult",
        data: result.data
      });
    } else {
      showNotification(tabId, result.message || "The API could not process this text.");
    }
  } catch (error) {
    console.error("ZeroGPT Extension: Fetch error:", error);
    showNotification(tabId, "Connection error. Please check your internet and API key validity.");
  }
}

function showNotification(tabId, message) {
  chrome.tabs.sendMessage(tabId, {
    action: "showError",
    message: message
  });
}
