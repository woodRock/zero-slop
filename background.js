import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, setDoc, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import firebaseConfig from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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
          performDetection(response.text, tab.id, response.tweetId, false, response.author);
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
        performDetection(request.text, sender.tab.id, request.tweetId, true, request.author);
      }
    });
  }
});

async function performDetection(text, tabId, tweetId = null, isAutoScan = false, author = null) {
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
      const percentage = result.data.fakePercentage || 0;
      
      // Save history
      saveToHistory(text, percentage, result.data.textWords);
      
      // Store in Firestore if it's "Slop" (e.g., > 70% AI)
      if (percentage > 70 && tweetId) {
        storeSlopTweet(tweetId, text, percentage, author);
      }

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

async function storeSlopTweet(tweetId, text, percentage, author) {
  try {
    const tweetRef = doc(db, "slop_registry", tweetId);
    
    const slopData = {
      tweet_id: tweetId,
      text: text.substring(0, 1000), // More room for slop
      ai_score: percentage,
      report_count: increment(1),
      status: "pending",
      last_updated: serverTimestamp(),
      created_at: serverTimestamp()
    };

    if (author) {
      slopData.author_info = {
        name: author.name,
        handle: author.handle,
        pfp_url: author.pfp
      };
    }
    
    await setDoc(tweetRef, slopData, { merge: true });

    console.log(`ZeroSlop: Tweet ${tweetId} from ${author?.handle || 'unknown'} reported to registry.`);
  } catch (e) {
    console.error("ZeroSlop: Error adding slop report to Firestore:", e);
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
