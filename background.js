// Firebase Configuration
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDDx5ZbgWcgsKxsP78EubqyWRHL9yxdXec",
  projectId: "zero-slop"
};

// Initialize context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    // Parent Menu
    chrome.contextMenus.create({
      id: "zeroSlopParent",
      title: "ZeroSlop",
      contexts: ["all"],
      documentUrlPatterns: ["*://*.twitter.com/*", "*://*.x.com/*"]
    });

    // Sub-item: Check Single
    chrome.contextMenus.create({
      id: "checkZeroGPT",
      parentId: "zeroSlopParent",
      title: "Check with ZeroGPT",
      contexts: ["all"]
    });

    // Sub-item: Check Thread
    chrome.contextMenus.create({
      id: "checkThread",
      parentId: "zeroSlopParent",
      title: "🧵 Scan This Thread",
      contexts: ["all"]
    });

    // Sub-item: Check Profile
    chrome.contextMenus.create({
      id: "checkProfile",
      parentId: "zeroSlopParent",
      title: "👤 Scan User Profile",
      contexts: ["all"]
    });

    // Sub-item: Report Account
    chrome.contextMenus.create({
      id: "reportAccount",
      parentId: "zeroSlopParent",
      title: "🚩 Mark as Slop Factory",
      contexts: ["all"]
    });

    // Sub-item: Report Slop
    chrome.contextMenus.create({
      id: "reportSlop",
      parentId: "zeroSlopParent",
      title: "🚩 Report as AI Slop",
      contexts: ["all"]
    });

    console.log("ZeroSlop: Context menus initialized.");
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "checkZeroGPT") {
    const textToCheck = info.selectionText;
    if (textToCheck) {
      performDetection(textToCheck, tab.id);
    } else {
      chrome.tabs.sendMessage(tab.id, { action: "getTweetText" }, (response) => {
        if (response && response.text) {
          performDetection(response.text, tab.id, response.tweetId, false, response.author);
        }
      });
    }
  } else if (info.menuItemId === "checkThread") {
    chrome.tabs.sendMessage(tab.id, { action: "getThreadText" }, (response) => {
      if (response && response.text) {
        performDetection(response.text, tab.id, response.tweetId, false, response.author, true);
      }
    });
  } else if (info.menuItemId === "checkProfile") {
    chrome.tabs.sendMessage(tab.id, { action: "getProfileText" }, (response) => {
      if (response && response.text) {
        performDetection(response.text, tab.id, null, false, response.author, true);
      }
    });
  } else if (info.menuItemId === "reportSlop") {
    chrome.tabs.sendMessage(tab.id, { action: "getTweetText" }, (response) => {
      if (response && response.tweetId) {
        storeSlopTweet(response.tweetId, response.text, 0, response.author, true);
        chrome.tabs.sendMessage(tab.id, { 
          action: "showResult", 
          data: { feedback_message: "Reported to ZeroSlop Registry" },
          isAutoScan: false
        });

        // Automated Amplifier Scan: Mark existing retweeters/quote-tweeters as suspicious
        scanAmplifiers(response.tweetId);
      }
    });
  }
  else if (info.menuItemId === "reportAccount") {
    chrome.tabs.sendMessage(tab.id, { action: "getProfileText" }, (response) => {
      if (response && response.author && response.author.handle) {
        storeSlopFactoryReport(response.author);
        chrome.tabs.sendMessage(tab.id, { 
          action: "showResult", 
          data: { feedback_message: `Marked ${response.author.handle} as Potential Slop Factory` },
          isAutoScan: false
        });

        // If we have a tweetId from the context of where they clicked, scan its amplifiers too
        chrome.tabs.sendMessage(tab.id, { action: "getTweetText" }, (tweetResponse) => {
          if (tweetResponse && tweetResponse.tweetId) {
            scanAmplifiers(tweetResponse.tweetId);
            // Also store this tweet as 100% manual slop since the author is a factory
            storeSlopTweet(tweetResponse.tweetId, tweetResponse.text, 100, response.author, true);
          }
        });
      }
    });
  }
});

function scanAmplifiers(tweetId) {
  const quoteUrl = `https://x.com/i/status/${tweetId}/quotes?zerogpt_scan=true`;
  const retweetUrl = `https://x.com/i/status/${tweetId}/retweets?zerogpt_scan=true`;
  
  chrome.tabs.create({ url: quoteUrl, active: false });
  chrome.tabs.create({ url: retweetUrl, active: false });
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "autoScanTweet") {
    chrome.storage.local.get(['autoScan'], (result) => {
      if (result.autoScan) {
        performDetection(request.text, sender.tab.id, request.tweetId, true, request.author);
      }
    });
  } else if (request.action === "closeScanTab") {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id);
    }
  } else if (request.action === "manualReport") {
    const score = request.aiScore || 0;
    storeSlopTweet(request.tweetId, request.text, score, request.author, true);
  } else if (request.action === "voteSlop") {
    voteSlopTweet(request.tweetId, request.voteType);
  } else if (request.action === "checkRegistry") {
    checkRegistry(request.tweetId).then(data => {
      if (data) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "showResult",
          data: { 
            fakePercentage: data.ai_score, 
            feedback_message: "From ZeroSlop Registry",
            upvotes: data.upvotes,
            downvotes: data.downvotes
          },
          tweetId: request.tweetId,
          isAutoScan: true
        });
        sendResponse(data);
      } else {
        sendResponse(null);
      }
    });
    return true;
  } else if (request.action === "reportSuspicious") {
    storeSuspiciousAccount(request.handle, request.name, request.pfp, request.tweetId);
  } else if (request.action === "manualReportAccount") {
    storeSlopFactoryReport(request.author);
  } else if (request.action === "checkSlopAccount") {
    checkSlopAccount(request.handle).then(data => {
      if (data) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "showSlopFactoryWarning",
          handle: request.handle
        });
        sendResponse(data);
      } else {
        sendResponse(null);
      }
    });
    return true;
  } else if (request.action === "checkSuspicious") {
    checkSuspiciousAccount(request.handle).then(data => {
      if (data) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "showSuspiciousWarning",
          handle: request.handle,
          reasonTweetId: data.reason_tweet_id
        });
        sendResponse(data);
      } else {
        sendResponse(null);
      }
    });
    return true;
  } else if (request.action === "checkProfileSlop") {
    checkProfileSlop(request.handle).then(data => {
      // REQUIREMENT: Must have at least 3 high-slop detections to trigger the public warning banner
      if (data && data.highSlopCount >= 3) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "showProfileWarning",
          handle: request.handle,
          highSlopCount: data.highSlopCount,
          avgScore: data.avgScore
        });
        sendResponse(data);
      } else {
        sendResponse(null);
      }
    });
    return true;
  }
});

async function checkSlopAccount(handle) {
  const accountId = handle.replace('@', '').toLowerCase();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_accounts/${accountId}?key=${FIREBASE_CONFIG.apiKey}`;

  try {
    const response = await fetch(url);
    if (response.ok) {
      const doc = await response.json();
      return {
        handle: doc.fields.handle?.stringValue,
        manual_reports: parseInt(doc.fields.manual_reports?.integerValue || 0)
      };
    }
  } catch (e) {}
  return null;
}

async function checkProfileSlop(handle) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents:runQuery?key=${FIREBASE_CONFIG.apiKey}`;
  const query = {
    structuredQuery: {
      from: [{ collectionId: "slop_registry" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "author_handle" },
          op: "EQUAL",
          value: { stringValue: handle }
        }
      }
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query)
    });

    if (response.ok) {
      const results = await response.json();
      const docs = results.filter(r => r.document).map(r => r.document);
      
      const highSlopDocs = docs.filter(doc => {
        const score = doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0;
        return score > 15;
      });

      if (highSlopDocs.length > 0) {
        const totalScore = docs.reduce((acc, doc) => acc + (doc.fields.ai_score?.doubleValue || doc.fields.ai_score?.integerValue || 0), 0);
        return {
          highSlopCount: highSlopDocs.length,
          avgScore: Math.round(totalScore / docs.length)
        };
      }
    }
  } catch (e) {
    console.error("ZeroSlop: Error checking profile slop", e);
  }
  return null;
}

function incrementSlopsCaught() {
  chrome.storage.local.get(['slopsCaught'], (result) => {
    const current = result.slopsCaught || 0;
    chrome.storage.local.set({ slopsCaught: current + 1 });
  });
}

async function checkRegistry(tweetId) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_registry/${tweetId}?key=${FIREBASE_CONFIG.apiKey}`;
  try {
    const response = await fetch(url);
    if (response.ok) {
      const doc = await response.json();
      const fields = doc.fields;
      return {
        ai_score: fields.ai_score?.doubleValue || fields.ai_score?.integerValue || 0,
        status: fields.status?.stringValue,
        upvotes: parseInt(fields.upvotes?.integerValue || 0),
        downvotes: parseInt(fields.downvotes?.integerValue || 0)
      };
    }
  } catch (e) {}
  return null;
}

async function storeSlopFactoryReport(author) {
  const accountId = author.handle.replace('@', '').toLowerCase();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_accounts/${accountId}?key=${FIREBASE_CONFIG.apiKey}`;

  try {
    const getResponse = await fetch(url);
    let currentReports = 0;
    let existingFields = {};

    if (getResponse.ok) {
      const doc = await getResponse.json();
      existingFields = doc.fields || {};
      currentReports = parseInt(existingFields.manual_reports?.integerValue || 0);
    }

    const fields = {
      ...existingFields,
      handle: { stringValue: author.handle },
      name: { stringValue: author.name || "" },
      pfp: { stringValue: author.pfp || "" },
      manual_reports: { integerValue: currentReports + 1 },
      last_reported: { timestampValue: new Date().toISOString() }
    };

    if (!existingFields.first_detected) {
      fields.first_detected = { timestampValue: new Date().toISOString() };
    }

    let maskParams = "";
    Object.keys(fields).forEach(key => {
      maskParams += `&updateMask.fieldPaths=${key}`;
    });

    await fetch(url + maskParams, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
  } catch (e) {
    console.error("ZeroSlop: Error reporting slop factory", e);
  }
}

async function performDetection(text, tabId, tweetId = null, isAutoScan = false, author = null, isThread = false) {
  const { zerogptApiKey } = await chrome.storage.local.get(['zerogptApiKey']);
  if (!zerogptApiKey) {
    if (!isAutoScan) {
      chrome.tabs.sendMessage(tabId, { 
        action: "showError", 
        message: "API Key is missing! Please set it in the extension popup." 
      });
    }
    return;
  }

  if (!isAutoScan) chrome.tabs.sendMessage(tabId, { action: "showLoader" });

  try {
    const response = await fetch("https://api.zerogpt.com/api/detect/detectText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "ApiKey": zerogptApiKey },
      body: JSON.stringify({ input_text: text })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success) {
        const percentage = result.data.fakePercentage || 0;
        saveToHistory(text, percentage, result.data.textWords);
        
        if (percentage > 15) {
          incrementSlopsCaught();
        }

        if (tweetId) {
          storeSlopTweet(tweetId, text, percentage, author, false);
        }

        chrome.tabs.sendMessage(tabId, {
          action: "showResult",
          data: { 
            ...result.data, 
            feedback_message: isThread ? `Thread Analysis: ${result.data.feedback_message || "Analyzed"}` : result.data.feedback_message,
            upvotes: 0,
            downvotes: 0
          },
          tweetId: tweetId,
          isAutoScan: isAutoScan
        });
      }
    }
  } catch (error) {
    console.error("ZeroSlop: Fetch error:", error);
  }
}

async function updateDailyTrend() {
  const dateStr = new Date().toISOString().split('T')[0];
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/trends/${dateStr}?key=${FIREBASE_CONFIG.apiKey}&updateMask.fieldPaths=count&updateMask.fieldPaths=last_updated`;

  try {
    const getResponse = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/trends/${dateStr}?key=${FIREBASE_CONFIG.apiKey}`);
    let currentCount = 0;

    if (getResponse.ok) {
      const doc = await getResponse.json();
      currentCount = parseInt(doc.fields.count?.integerValue || 0);
    }

    const fields = {
      count: { integerValue: currentCount + 1 },
      last_updated: { timestampValue: new Date().toISOString() }
    };

    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
  } catch (e) {
    console.error("ZeroSlop: Error updating daily trend", e);
  }
}

async function updateGlobalStats(fieldName = 'total_slops') {
  if (fieldName === 'total_slops') {
    updateDailyTrend();
  }
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/stats/global?key=${FIREBASE_CONFIG.apiKey}&updateMask.fieldPaths=${fieldName}&updateMask.fieldPaths=last_updated`;

  try {
    const getResponse = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/stats/global?key=${FIREBASE_CONFIG.apiKey}`);
    let currentCount = 0;
    let existingFields = {};

    if (getResponse.ok) {
      const doc = await getResponse.json();
      existingFields = doc.fields || {};
      currentCount = parseInt(existingFields[fieldName]?.integerValue || 0);
    }

    const fields = {
      ...existingFields,
      [fieldName]: { integerValue: currentCount + 1 },
      last_updated: { timestampValue: new Date().toISOString() }
    };

    // Only PATCH the fields we want to update
    const patchFields = {
      [fieldName]: { integerValue: currentCount + 1 },
      last_updated: { timestampValue: new Date().toISOString() }
    };

    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: patchFields })
    });
  } catch (e) {
    console.error(`ZeroSlop: Error updating global stats for ${fieldName}`, e);
  }
}

async function storeSlopTweet(tweetId, text, percentage, author, isManual = false) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_registry/${tweetId}?key=${FIREBASE_CONFIG.apiKey}`;
  
  const fields = {
    tweet_id: { stringValue: tweetId },
    text: { stringValue: text?.substring(0, 1000) || "" },
    status: { stringValue: "pending" },
    last_updated: { timestampValue: new Date().toISOString() }
  };

  const isSlop = (percentage > 15 || isManual);

  if (percentage > 0) {
    fields.ai_score = { doubleValue: parseFloat(percentage) };
    if (percentage > 15) {
      incrementSlopsCaught();
      updateGlobalStats('total_slops');
    }
  } else if (isManual) {
    incrementSlopsCaught();
    updateGlobalStats('total_slops');
  }

  if (isManual) fields.manual_report = { booleanValue: true };
  
  if (author) {
    if (author.name) fields.author_name = { stringValue: author.name };
    if (author.handle) fields.author_handle = { stringValue: author.handle };
    if (author.pfp) fields.author_pfp = { stringValue: author.pfp };

    // Track unique accounts if it's slop
    if (author.handle && isSlop) {
      const accountId = author.handle.replace('@', '').toLowerCase();
      const accountUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_accounts/${accountId}?key=${FIREBASE_CONFIG.apiKey}`;
      
      try {
        const accCheck = await fetch(accountUrl);
        if (!accCheck.ok) {
          // New slop factory detected!
          await fetch(accountUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fields: {
                handle: { stringValue: author.handle },
                name: { stringValue: author.name || "" },
                pfp: { stringValue: author.pfp || "" },
                first_detected: { timestampValue: new Date().toISOString() }
              }
            })
          });
          updateGlobalStats('total_accounts');
        }
      } catch (e) {
        console.error("ZeroSlop: Error tracking account:", e);
      }
    }
  }

  let maskParams = "";
  Object.keys(fields).forEach(key => {
    maskParams += `&updateMask.fieldPaths=${key}`;
  });

  try {
    await fetch(url + maskParams, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
  } catch (e) {
    console.error("ZeroSlop: Firestore error:", e);
  }
}

async function voteSlopTweet(tweetId, voteType) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/slop_registry/${tweetId}?key=${FIREBASE_CONFIG.apiKey}`;
  
  try {
    const getResponse = await fetch(url);
    if (!getResponse.ok) return;
    const doc = await getResponse.json();
    
    const fields = {};
    if (voteType === 'up') {
      const currentUp = doc.fields.upvotes?.integerValue || 0;
      fields.upvotes = { integerValue: parseInt(currentUp) + 1 };
    } else {
      const currentDown = doc.fields.downvotes?.integerValue || 0;
      fields.downvotes = { integerValue: parseInt(currentDown) + 1 };
    }
    
    let maskParams = `&updateMask.fieldPaths=${voteType === 'up' ? 'upvotes' : 'downvotes'}`;
    
    await fetch(url + maskParams, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
  } catch (e) {
    console.error("ZeroSlop: Error voting", e);
  }
}

function saveToHistory(text, percentage, words) {
  chrome.storage.local.get(['scanHistory'], (result) => {
    let history = result.scanHistory || [];
    history.push({
      timestamp: new Date().toISOString(),
      text: text.substring(0, 200),
      percentage: percentage || 0,
      words: words || 0
    });
    if (history.length > 50) history = history.slice(-50);
    chrome.storage.local.set({ scanHistory: history });
  });
}

async function storeSuspiciousAccount(handle, name, pfp, tweetId) {
  const accountId = handle.replace('@', '').toLowerCase();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/suspicious_accounts/${accountId}?key=${FIREBASE_CONFIG.apiKey}`;

  const fields = {
    handle: { stringValue: handle },
    name: { stringValue: name || "" },
    pfp: { stringValue: pfp || "" },
    reason_tweet_id: { stringValue: tweetId },
    detected_at: { timestampValue: new Date().toISOString() }
  };

  try {
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
  } catch (e) {
    console.error("ZeroSlop: Error storing suspicious account", e);
  }
}

async function checkSuspiciousAccount(handle) {
  const accountId = handle.replace('@', '').toLowerCase();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/suspicious_accounts/${accountId}?key=${FIREBASE_CONFIG.apiKey}`;

  try {
    const response = await fetch(url);
    if (response.ok) {
      const doc = await response.json();
      return {
        reason_tweet_id: doc.fields.reason_tweet_id?.stringValue
      };
    }
  } catch (e) {}
  return null;
}
