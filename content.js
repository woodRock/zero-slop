let lastRightClickedElement = null;

// Track right-click position to find the element
document.addEventListener('contextmenu', (event) => {
  lastRightClickedElement = event.target;
}, true);

// Global to store the last detection result for the current tweet/profile
let currentOverlayInfo = null;

// Listen for storage changes to handle toggle updates in real-time
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.autoHumanDetection) {
      // Remove all Smart Slop badges if disabled
      if (!changes.autoHumanDetection.newValue) {
        document.querySelectorAll('.zeroslop-smart-badge').forEach(badge => badge.remove());
      }
    }
  }
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(`ZeroSlop: Received action ${request.action}`);
  
  if (request.action === "getTweetText") {
    const info = extractTweetInfo(lastRightClickedElement);
    sendResponse(info);
  } else if (request.action === "getThreadText") {
    const info = extractThreadInfo(lastRightClickedElement);
    sendResponse(info);
  } else if (request.action === "getProfileText") {
    const info = extractProfileInfo(lastRightClickedElement);
    sendResponse(info);
  } else if (request.action === "showLoader") {
    showOverlay("Analyzing text with ZeroGPT...");
  } else if (request.action === "showResult") {
    const data = request.data;
    const isAutoScan = request.isAutoScan;
    
    // Store info for buttons
    if (!isAutoScan) {
      const activeElement = lastRightClickedElement;
      if (data.feedback_message?.includes("Thread Analysis")) {
        currentOverlayInfo = extractThreadInfo(activeElement);
      } else if (!request.tweetId) {
        currentOverlayInfo = extractProfileInfo(activeElement);
      } else {
        currentOverlayInfo = extractTweetInfo(activeElement);
      }
      
      const message = `AI Generation: ${data.fakePercentage || 0}%\n` +
                      `Status: ${data.feedback_message || "Analyzed"}\n` +
                      `Words: ${data.textWords || 0}`;
      showOverlay(message, "success", data.fakePercentage);
    }
    
    const container = request.tweetId ? null : getTweetContainer(lastRightClickedElement);
    injectBadge(request.tweetId || container, data.fakePercentage || 0, data.upvotes || 0, data.downvotes || 0);
  } else if (request.action === "adminShowBadge") {
    const { percentage, tweetId, author } = request.data;
    console.log(`ZeroSlop Admin: Badge request for tweet ${tweetId} at ${percentage}%`);
    const container = getTweetContainerByTweetId(tweetId);

    if (!container) {
      console.warn(`ZeroSlop Admin: Could not find container for tweet ${tweetId}`);
      return;
    }

    // Check if author is a known slop factory
    if (author?.handle) {
      chrome.runtime.sendMessage({ action: "checkSlopAccount", handle: author.handle }, (result) => {
        const isSlopFactory = result && (result.shield_type === 'red' || result.shield_type === 'blue');
        
        if (isSlopFactory) {
          // Known slop factory - show slop factory badge with different behavior
          console.log(`ZeroSlop Admin: ${author.handle} is known slop factory (shield: ${result.shield_type}), showing factory badge`);
          injectHumanBadge(container, tweetId, author, percentage, true);
        } else if (percentage <= 15) {
          // Not a known factory and low AI score - show human badge
          console.log(`ZeroSlop Admin: Injecting human badge for ${tweetId}`);
          injectHumanBadge(container, tweetId, author, percentage, false);
        } else {
          // High AI score - show AI badge
          console.log(`ZeroSlop Admin: Injecting AI badge for ${tweetId}`);
          injectLikelyAIBadge(container, tweetId, author, percentage);
        }
      });
    } else if (percentage <= 15) {
      // No author info but low AI score - show human badge
      console.log(`ZeroSlop Admin: Injecting human badge for ${tweetId} (no author)`);
      injectHumanBadge(container, tweetId, author, percentage, false);
    } else {
      // High AI score - show AI badge
      console.log(`ZeroSlop Admin: Injecting AI badge for ${tweetId}`);
      injectLikelyAIBadge(container, tweetId, author, percentage);
    }
  } else if (request.action === "showError") {
    showOverlay(request.message, "error");
  } else if (request.action === "showProfileWarning") {
    injectProfileBanner(request.handle, request.highSlopCount, request.avgScore);
  } else if (request.action === "showSuspiciousWarning") {
    injectSuspiciousBanner(request.handle, request.reasonTweetId);
    // Also find all visible tweets by this handle and add badge
    const articles = document.querySelectorAll('article');
    articles.forEach(article => {
      const info = extractTweetInfo(article);
      if (info.author?.handle === request.handle) {
        injectSuspiciousBadge(article, request.handle);
      }
    });
  } else if (request.action === "showSlopFactoryWarning") {
    injectSlopFactoryBanner(request.handle);
    // Also inject badge in header if on profile
    injectSlopFactoryHeaderBadge(request.handle);
    const articles = document.querySelectorAll('article');
    articles.forEach(article => {
      const info = extractTweetInfo(article);
      if (info.author?.handle === request.handle) {
        injectSlopFactoryBadge(article, request.handle);
      }
    });
  } else if (request.action === "showHighAIWarning") {
    injectHighAIBanner(request.handle);
    injectHighAIHeaderBadge(request.handle);
    const articles = document.querySelectorAll('article');
    articles.forEach(article => {
      const info = extractTweetInfo(article);
      if (info.author?.handle === request.handle) {
        injectHighAIBadge(article, request.handle);
      }
    });
  } else if (request.action === "showOrganicSuccess") {
    injectOrganicBanner(request.handle);
    injectOrganicHeaderBadge(request.handle);
    const articles = document.querySelectorAll('article');
    articles.forEach(article => {
      const info = extractTweetInfo(article);
      if (info.author?.handle === request.handle) {
        injectOrganicBadge(article, request.handle);
      }
    });
  }
  return true; 
});

function injectSlopFactoryBanner(handle) {
  const existing = document.getElementById('zerogpt-slopfactory-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'zerogpt-slopfactory-banner';
  banner.style.cssText = `
    background: #000;
    color: #fff;
    padding: 12px;
    text-align: center;
    font-weight: bold;
    font-size: 14px;
    position: sticky;
    top: 0;
    z-index: 9999;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
    border-bottom: 2px solid #f4212e;
  `;
  banner.innerHTML = `
    <span>🚩 RED SHIELD: SLOP FACTORY DETECTED (${handle})</span>
    <a href="https://woodrock.github.io/zero-slop?search=${handle.replace('@', '')}" target="_blank" style="color: #1d9bf0; text-decoration: underline; font-size: 12px;">View Network Map</a>
    <button id="close-slopfactory-banner" style="background: #f4212e; border: none; color: #fff; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; font-weight: bold;">Dismiss</button>
  `;

  document.body.prepend(banner);
  banner.querySelector('#close-slopfactory-banner').onclick = () => banner.remove();
}

function injectSlopFactoryHeaderBadge(handle) {
  // Try to find the profile header name
  const userNameHeader = document.querySelector('[data-testid="UserName"]');
  if (!userNameHeader || userNameHeader.querySelector('.zerogpt-slopfactory-header-badge')) return;

  const badge = document.createElement('div');
  badge.className = 'zerogpt-slopfactory-header-badge';
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    margin-top: 4px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: bold;
    color: #fff;
    background-color: #000;
    border: 2px solid #f4212e;
    cursor: help;
  `;
  badge.innerHTML = `🚩 RED SHIELD: FACTORY <span class="v-up" style="cursor:pointer;margin-left:8px;">👍</span><span class="v-down" style="cursor:pointer;margin-left:4px;">👎</span>`;
  
  badge.querySelector('.v-up').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "up" });
    badge.querySelector('.v-up').innerText = '✅';
  };
  badge.querySelector('.v-down').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "down" });
    badge.querySelector('.v-down').innerText = '❌';
  };

  userNameHeader.appendChild(badge);
}

function injectSlopFactoryBadge(container, handle) {
  if (!container || container.querySelector('.zerogpt-slopfactory-badge')) return;
  
  // Clean up any local "Likely Human" badges if we've now verified this as a factory
  const localBadge = container.querySelector('.zerogpt-likely-human-badge');
  if (localBadge) localBadge.remove();

  const badge = document.createElement('div');
  badge.className = 'zerogpt-slopfactory-badge';
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    margin-left: 8px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: bold;
    color: #fff;
    background-color: #000;
    border: 1px solid #f4212e;
    vertical-align: middle;
    line-height: 1;
    height: 16px;
    cursor: help;
  `;
  badge.innerHTML = `🚩 RED SHIELD: FACTORY <span class="v-up" style="cursor:pointer;margin-left:4px;">👍</span><span class="v-down" style="cursor:pointer;margin-left:2px;">👎</span>`;
  badge.title = 'Confirmed Slop Factory. Community verification in progress.';

  badge.querySelector('.v-up').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "up" });
    badge.querySelector('.v-up').innerText = '✅';
  };
  badge.querySelector('.v-down').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "down" });
    badge.querySelector('.v-down').innerText = '❌';
  };

  const timeElement = container.querySelector('time');
  if (timeElement && timeElement.parentNode) {
    timeElement.parentNode.appendChild(badge);
  }

  // Handle Auto-Action for Slop Factories
  handleAutoAction(container, 100);
}

function injectHighAIBanner(handle) {
  const existing = document.getElementById('zerogpt-highai-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'zerogpt-highai-banner';
  banner.style.cssText = `
    background: #1d9bf0;
    color: #fff;
    padding: 12px;
    text-align: center;
    font-weight: bold;
    font-size: 14px;
    position: sticky;
    top: 0;
    z-index: 9999;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
  `;
  banner.innerHTML = `
    <span>🔵 BLUE SHIELD: HIGH AI USAGE (${handle})</span>
    <button id="close-highai-banner" style="background: rgba(255,255,255,0.2); border: none; color: #fff; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; font-weight: bold;">Dismiss</button>
  `;

  document.body.prepend(banner);
  banner.querySelector('#close-highai-banner').onclick = () => banner.remove();
}

function injectHighAIHeaderBadge(handle) {
  const userNameHeader = document.querySelector('[data-testid="UserName"]');
  if (!userNameHeader || userNameHeader.querySelector('.zerogpt-highai-header-badge')) return;

  const badge = document.createElement('div');
  badge.className = 'zerogpt-highai-header-badge';
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    margin-top: 4px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: bold;
    color: #fff;
    background-color: #000;
    border: 2px solid #1d9bf0;
    cursor: help;
  `;
  badge.innerHTML = `🔵 BLUE SHIELD: HIGH AI <span class="v-up" style="cursor:pointer;margin-left:8px;">👍</span><span class="v-down" style="cursor:pointer;margin-left:4px;">👎</span>`;
  
  badge.querySelector('.v-up').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "up" });
    badge.querySelector('.v-up').innerText = '✅';
  };
  badge.querySelector('.v-down').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "down" });
    badge.querySelector('.v-down').innerText = '❌';
  };

  userNameHeader.appendChild(badge);
}

function injectHighAIBadge(container, handle) {
  if (!container || container.querySelector('.zerogpt-highai-badge')) return;

  const localBadge = container.querySelector('.zerogpt-likely-human-badge');
  if (localBadge) localBadge.remove();

  const badge = document.createElement('div');
  badge.className = 'zerogpt-highai-badge';
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    margin-left: 8px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: bold;
    color: #fff;
    background-color: #000;
    border: 1px solid #1d9bf0;
    vertical-align: middle;
    line-height: 1;
    height: 16px;
    cursor: help;
  `;
  badge.innerHTML = `🔵 BLUE SHIELD: HIGH AI <span class="v-up" style="cursor:pointer;margin-left:4px;">👍</span><span class="v-down" style="cursor:pointer;margin-left:2px;">👎</span>`;

  badge.querySelector('.v-up').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "up" });
    badge.querySelector('.v-up').innerText = '✅';
  };
  badge.querySelector('.v-down').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "down" });
    badge.querySelector('.v-down').innerText = '❌';
  };

  const timeElement = container.querySelector('time');
  if (timeElement && timeElement.parentNode) {
    timeElement.parentNode.appendChild(badge);
  }
}

function injectOrganicBanner(handle) {
  const existing = document.getElementById('zerogpt-organic-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'zerogpt-organic-banner';
  banner.style.cssText = `
    background: #00ba7c;
    color: #fff;
    padding: 12px;
    text-align: center;
    font-weight: bold;
    font-size: 14px;
    position: sticky;
    top: 0;
    z-index: 9999;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
  `;
  banner.innerHTML = `
    <span>🌿 GREEN SHIELD: VERIFIED HUMAN (${handle})</span>
    <button id="close-organic-banner" style="background: rgba(255,255,255,0.2); border: none; color: #fff; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; font-weight: bold;">Dismiss</button>
  `;

  document.body.prepend(banner);
  banner.querySelector('#close-organic-banner').onclick = () => banner.remove();
}

function injectOrganicHeaderBadge(handle) {
  const userNameHeader = document.querySelector('[data-testid="UserName"]');
  if (!userNameHeader || userNameHeader.querySelector('.zerogpt-organic-header-badge')) return;

  const badge = document.createElement('div');
  badge.className = 'zerogpt-organic-header-badge';
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    margin-top: 4px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: bold;
    color: #fff;
    background-color: #000;
    border: 2px solid #00ba7c;
    cursor: help;
  `;
  badge.innerHTML = `🌿 GREEN SHIELD: HUMAN <span class="v-up" style="cursor:pointer;margin-left:8px;">👍</span><span class="v-down" style="cursor:pointer;margin-left:4px;">👎</span>`;
  
  badge.querySelector('.v-up').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "up" });
    badge.querySelector('.v-up').innerText = '✅';
  };
  badge.querySelector('.v-down').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "down" });
    badge.querySelector('.v-down').innerText = '❌';
  };

  userNameHeader.appendChild(badge);
}

function injectOrganicBadge(container, handle) {
  if (!container || container.querySelector('.zerogpt-organic-badge')) return;

  const localBadge = container.querySelector('.zerogpt-likely-human-badge');
  if (localBadge) localBadge.remove();

  const badge = document.createElement('div');
  badge.className = 'zerogpt-organic-badge';
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    margin-left: 8px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: bold;
    color: #fff;
    background-color: #000;
    border: 1px solid #00ba7c;
    vertical-align: middle;
    line-height: 1;
    height: 16px;
    cursor: help;
  `;
  badge.innerHTML = `🌿 GREEN SHIELD: HUMAN <span class="v-up" style="cursor:pointer;margin-left:4px;">👍</span><span class="v-down" style="cursor:pointer;margin-left:2px;">👎</span>`;

  badge.querySelector('.v-up').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "up" });
    badge.querySelector('.v-up').innerText = '✅';
  };
  badge.querySelector('.v-down').onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    chrome.runtime.sendMessage({ action: "voteAccount", handle: handle, voteType: "down" });
    badge.querySelector('.v-down').innerText = '❌';
  };

  const timeElement = container.querySelector('time');
  if (timeElement && timeElement.parentNode) {
    timeElement.parentNode.appendChild(badge);
  }
}

function injectSuspiciousBanner(handle, reasonTweetId) {
  const existing = document.getElementById('zerogpt-suspicious-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'zerogpt-suspicious-banner';
  banner.style.cssText = `
    background: #ffd700;
    color: #000;
    padding: 12px;
    text-align: center;
    font-weight: bold;
    font-size: 14px;
    position: sticky;
    top: 0;
    z-index: 9999;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border-bottom: 2px solid rgba(0,0,0,0.1);
  `;
  banner.innerHTML = `
    <span>🕵️ POTENTIAL BOT: ${handle} recently retweeted a confirmed AI-slop tweet.</span>
    <a href="https://x.com/i/status/${reasonTweetId}" target="_blank" style="color: #000; text-decoration: underline; font-size: 12px;">View Slop</a>
    <button id="close-suspicious-banner" style="background: rgba(0,0,0,0.1); border: none; color: #000; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px;">Dismiss</button>
  `;

  document.body.prepend(banner);
  banner.querySelector('#close-suspicious-banner').onclick = () => banner.remove();
}

function injectSuspiciousBadge(container, handle) {
  if (!container || container.querySelector('.zerogpt-suspicious-badge')) return;

  const localBadge = container.querySelector('.zerogpt-likely-human-badge');
  if (localBadge) localBadge.remove();

  const badge = document.createElement('div');
  badge.className = 'zerogpt-suspicious-badge';
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    margin-left: 8px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: bold;
    color: #000;
    background-color: #ffd700;
    vertical-align: middle;
    line-height: 1;
    height: 16px;
    cursor: help;
  `;
  badge.innerText = '⚠️ ORANGE SHIELD: SUSPICIOUS';
  badge.title = 'This account has recently interacted with AI-slop factories.';

  const timeElement = container.querySelector('time');
  if (timeElement && timeElement.parentNode) {
    timeElement.parentNode.appendChild(badge);
  }
}

function injectProfileBanner(handle, highSlopCount, avgScore) {
  const existing = document.getElementById('zerogpt-profile-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'zerogpt-profile-banner';
  banner.style.cssText = `
    background: #f4212e;
    color: white;
    padding: 12px;
    text-align: center;
    font-weight: bold;
    font-size: 14px;
    position: sticky;
    top: 0;
    z-index: 9999;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  `;
  banner.innerHTML = `
    <span>⚠️ SLOP WARNING: ${handle} has ${highSlopCount} high-slop detections (Avg: ${avgScore}% AI)</span>
    <button id="verify-slop-factory" style="background: white; border: none; color: #f4212e; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; font-weight: bold;">Verify as Slop Factory</button>
    <button id="close-slop-banner" style="background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px;">Dismiss</button>
  `;

  document.body.prepend(banner);
  banner.querySelector('#close-slop-banner').onclick = () => banner.remove();
  banner.querySelector('#verify-slop-factory').onclick = () => {
    const info = extractProfileInfo(null);
    if (info && info.author && info.author.handle) {
      chrome.runtime.sendMessage({ action: "manualReportAccount", author: info.author });
      banner.querySelector('#verify-slop-factory').innerText = '✅ Reported';
      banner.querySelector('#verify-slop-factory').disabled = true;
    }
  };
}

function getTweetContainer(element) {
  if (!element) return null;
  let container = element.closest('article');
  if (!container) container = element.closest('[data-testid="cellInnerDiv"]');
  if (!container) container = element.closest('[data-testid="tweet"]');
  return container;
}

function getTweetContainerByTweetId(tweetId) {
  if (!tweetId) return null;
  return document.querySelector(`article[data-zerogpt-tweet-id="${tweetId}"]`) ||
         document.querySelector(`article a[href*="/status/${tweetId}"]`)?.closest('article') ||
         document.querySelector(`[data-zerogpt-id="${tweetId}"]`);
}

function extractTweetInfo(element) {
  const container = getTweetContainer(element);
  let text = "";
  let tweetId = "local-" + Date.now();
  let author = { name: "Unknown", handle: "@anonymous", pfp: "" };
  
  if (container) {
    const tweetTextDiv = container.querySelector('[data-testid="tweetText"]');
    if (tweetTextDiv) {
      text = tweetTextDiv.innerText || tweetTextDiv.textContent || "";
    }

    const timeLink = container.querySelector('time')?.parentElement;
    if (timeLink && timeLink.href) {
      const match = timeLink.href.match(/\/status\/(\d+)/);
      if (match) tweetId = match[1];
    }

    const userNameDiv = container.querySelector('[data-testid="User-Name"]');
    if (userNameDiv) {
      const nameEl = userNameDiv.querySelector('span');
      if (nameEl) author.name = nameEl.innerText;
      
      const links = userNameDiv.querySelectorAll('a');
      for (const link of links) {
        if (link.innerText && link.innerText.startsWith('@')) {
          author.handle = link.innerText;
          break;
        }
      }
    }

    const pfpEl = container.querySelector('[data-testid="Tweet-User-Avatar"] img') || 
                  container.querySelector('img[src*="profile_images"]');
    if (pfpEl) author.pfp = pfpEl.src;

    return { text, tweetId, author };
  }

  // Fallback for non-container elements
  const nearbyText = element ? element.closest('[data-testid="tweetText"]') : null;
  if (nearbyText) {
    text = nearbyText.innerText || nearbyText.textContent || "";
  }
  return { text, tweetId, author };
}

function extractThreadInfo(element) {
  const currentTweetInfo = extractTweetInfo(element);
  if (!currentTweetInfo.author?.handle) return currentTweetInfo;

  const targetHandle = currentTweetInfo.author.handle;
  const articles = document.querySelectorAll('article');
  let combinedText = "";
  let count = 0;

  articles.forEach(article => {
    const userNameDiv = article.querySelector('[data-testid="User-Name"]');
    if (userNameDiv) {
      const handleLink = Array.from(userNameDiv.querySelectorAll('a')).find(a => a.innerText === targetHandle);
      if (handleLink) {
        const textDiv = article.querySelector('[data-testid="tweetText"]');
        if (textDiv) {
          combinedText += (textDiv.innerText || textDiv.textContent) + "\n\n";
          count++;
        }
      }
    }
  });

  return {
    ...currentTweetInfo,
    text: combinedText.trim(),
    isThread: true,
    tweetCount: count
  };
}

function extractProfileInfo(element) {
  const currentTweetInfo = extractTweetInfo(element);
  let targetHandle = currentTweetInfo.author?.handle;

  if (!targetHandle) {
    const pathParts = window.location.pathname.split('/');
    if (pathParts.length >= 2 && !['home', 'explore', 'notifications', 'messages', 'search', 'settings'].includes(pathParts[1])) {
      targetHandle = '@' + pathParts[1];
    }
  }

  if (!targetHandle) return currentTweetInfo;

  const articles = document.querySelectorAll('article');
  let combinedText = "";
  let count = 0;

  articles.forEach(article => {
    const userNameDiv = article.querySelector('[data-testid="User-Name"]');
    if (userNameDiv) {
      const handleLink = Array.from(userNameDiv.querySelectorAll('a')).find(a => a.innerText.toLowerCase() === targetHandle.toLowerCase());
      if (handleLink) {
        const textDiv = article.querySelector('[data-testid="tweetText"]');
        if (textDiv) {
          combinedText += (textDiv.innerText || textDiv.textContent) + "\n\n";
          count++;
        }
      }
    }
  });

  return {
    ...currentTweetInfo,
    text: combinedText.trim(),
    isThread: true,
    tweetCount: count,
    author: { ... (currentTweetInfo.author || {}), handle: targetHandle }
  };
}

function injectBadge(tweetIdOrContainer, percentage, upvotes = 0, downvotes = 0) {
  let container;
  let tweetIdString = "";

  if (typeof tweetIdOrContainer === 'string') {
    tweetIdString = tweetIdOrContainer;
    container = document.querySelector(`article a[href*="/status/${tweetIdOrContainer}"]`)?.closest('article') ||
                document.querySelector(`[data-zerogpt-id="${tweetIdOrContainer}"]`);
  } else {
    container = tweetIdOrContainer;
    const info = extractTweetInfo(container);
    tweetIdString = info.tweetId;
  }

  if (!container || container.querySelector('.zerogpt-badge')) return;

  const localBadge = container.querySelector('.zerogpt-likely-human-badge');
  if (localBadge) localBadge.remove();

  if (downvotes > upvotes + 2) {
    return;
  }

  const badge = document.createElement('div');
  badge.className = 'zerogpt-badge';
  
  let color = '#17a2b8';
  if (percentage > 70) color = '#f4212e';
  else if (percentage < 30) color = '#00ba7c';
  else color = '#ffd700';

  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    margin-left: 8px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: bold;
    color: white;
    background-color: ${color};
    vertical-align: middle;
    line-height: 1;
    height: 18px;
    cursor: help;
    border: 1px solid rgba(255,255,255,0.2);
  `;
  badge.innerHTML = `AI: ${percentage}% [↑${upvotes} | ↓${downvotes}] <span class="vote-up" style="cursor:pointer;margin-left:4px;">👍</span><span class="vote-down" style="cursor:pointer;margin-left:2px;">👎</span>`;
  badge.title = 'ZeroSlop Registry Score';

  badge.querySelector('.vote-up').addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (tweetIdString) {
      chrome.runtime.sendMessage({ action: "voteSlop", voteType: "up", tweetId: tweetIdString });
      badge.querySelector('.vote-up').innerText = '✅';
    }
  });

  badge.querySelector('.vote-down').addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (tweetIdString) {
      chrome.runtime.sendMessage({ action: "voteSlop", voteType: "down", tweetId: tweetIdString });
      badge.querySelector('.vote-down').innerText = '❌';
    }
  });

  const timeElement = container.querySelector('time');
  if (timeElement && timeElement.parentNode) {
    timeElement.parentNode.appendChild(badge);
  }

  handleAutoAction(container, percentage);
}

function injectHumanBadge(container, tweetId, author, percentage, isSlopFactory = false) {
  if (!container || container.querySelector('.zerogpt-human-badge')) return;

  const badge = document.createElement('div');
  badge.className = 'zerogpt-human-badge';
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    margin-left: 8px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: bold;
    color: #fff;
    background-color: #00ba7c;
    vertical-align: middle;
    line-height: 1;
    height: 18px;
    cursor: help;
    border: 1px solid rgba(255,255,255,0.2);
  `;
  
  if (isSlopFactory) {
    badge.innerHTML = `🚩 Slop Factory Tweet ${percentage}% <span class="human-vote-up" style="cursor:pointer;margin-left:4px;">👍</span><span class="human-vote-down" style="cursor:pointer;margin-left:2px;">👎</span>`;
    badge.title = 'This is from a known slop factory. Click 👍 to confirm and add to slop registry.';
  } else {
    badge.innerHTML = `🌿 Human-Generated ${percentage}% <span class="human-vote-up" style="cursor:pointer;margin-left:4px;">👍</span><span class="human-vote-down" style="cursor:pointer;margin-left:2px;">👎</span>`;
    badge.title = 'Verified human-generated content. Click 👍 to add to dataset.';
  }

  badge.querySelector('.human-vote-up').addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const tweetText = container.querySelector('[data-testid="tweetText"]')?.innerText || "";

    if (isSlopFactory) {
      // Add to slop registry instead of human registry
      chrome.runtime.sendMessage({
        action: "manualReport",
        tweetId: tweetId,
        text: tweetText,
        aiScore: percentage,
        author: author,
        slopType: "type_slop_factory",
        shieldType: "shield-red"
      });
      console.log(`ZeroSlop Admin: Added slop factory tweet ${tweetId} to registry`);
    } else {
      // Add to human registry
      console.log(`ZeroSlop Admin: Sending voteHuman for tweet ${tweetId}, text length: ${tweetText.length}, author: ${author?.handle}`);
      chrome.runtime.sendMessage({
        action: "voteHuman",
        voteType: "up",
        tweetId: tweetId,
        text: tweetText,
        author: author
      }, (response) => {
        console.log(`ZeroSlop Admin: voteHuman response:`, response);
      });
      console.log(`ZeroSlop Admin: Added human tweet ${tweetId} to human registry`);
    }

    badge.querySelector('.human-vote-up').innerText = '✅';
    badge.querySelector('.human-vote-down').remove();
  });

  badge.querySelector('.human-vote-down').addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Thumbs down: discard, just remove the badge
    badge.remove();
  });

  const timeElement = container.querySelector('time');
  if (timeElement && timeElement.parentNode) {
    timeElement.parentNode.appendChild(badge);
  }
}

function injectLikelyAIBadge(container, tweetId, author, percentage) {
  if (!container || container.querySelector('.zerogpt-likely-ai-badge')) return;

  const badge = document.createElement('div');
  badge.className = 'zerogpt-likely-ai-badge';
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    margin-left: 8px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: bold;
    color: #fff;
    background-color: #f4212e;
    vertical-align: middle;
    line-height: 1;
    height: 18px;
    cursor: help;
    border: 1px solid rgba(255,255,255,0.2);
  `;
  badge.innerHTML = `⚠️ Likely AI ${percentage}%`;
  badge.title = 'This tweet appears to be AI-generated.';

  const timeElement = container.querySelector('time');
  if (timeElement && timeElement.parentNode) {
    timeElement.parentNode.appendChild(badge);
  }
}

function injectSmartSlopBadge(container, labelText = "SMART SLOP SIGNAL", bgColor = "#ffd700", textColor = "#000") {
  if (!container) return;
  
  // Do not inject if ANY other ZeroSlop-related badge is already present
  const hasOtherBadge = container.querySelector(
    '.zerogpt-badge, .zerogpt-slopfactory-badge, .zerogpt-highai-badge, .zerogpt-organic-badge, .zerogpt-suspicious-badge, .zerogpt-likely-human-badge, .zeroslop-smart-badge'
  );
  if (hasOtherBadge) return;

  const badge = document.createElement('div');
  badge.className = 'zeroslop-smart-badge';
  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    margin-left: 8px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: bold;
    color: ${textColor};
    background-color: ${bgColor};
    border: 1px solid rgba(0,0,0,0.1);
    vertical-align: middle;
    line-height: 1;
    height: 16px;
    cursor: help;
  `;
  badge.innerHTML = `🟡 ${labelText}`;
  badge.title = `Smart Slop Guard: Our local model detected structural hallmarks of industrial engagement farming.`;

  const timeElement = container.querySelector('time');
  if (timeElement && timeElement.parentNode) {
    timeElement.parentNode.appendChild(badge);
  }
}

async function initObservers() {
  if (window.zerogptObserver) window.zerogptObserver.disconnect();
  
  // Initialize local classifier
  await ZeroSlopClassifier.load();

  const checkContext = () => {
    const path = window.location.pathname;
    const parts = path.split('/').filter(Boolean);
    
    if (parts.length === 1 && !['home', 'explore', 'notifications', 'messages', 'search', 'settings'].includes(parts[0])) {
      const handle = '@' + parts[0];
      chrome.runtime.sendMessage({ action: "checkProfileSlop", handle: handle });
      chrome.runtime.sendMessage({ action: "checkSuspicious", handle: handle });
      chrome.runtime.sendMessage({ action: "checkSlopAccount", handle: handle });
    }

    if (path.includes('/following') || path.includes('/followers') || path.includes('/verified_followers')) {
      injectListAuditorButton();
    }
  };
  
  checkContext();
  
  let lastPath = window.location.pathname;
  const navObserver = new MutationObserver(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      checkContext();
      ['zerogpt-profile-banner', 'zerogpt-suspicious-banner', 'zerogpt-list-auditor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
    }
  });
  navObserver.observe(document.head, { childList: true, subtree: true });

  window.zerogptObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const container = entry.target;
        
        if (container.tagName === 'ARTICLE' && !container.dataset.zerogptChecked) {
          container.dataset.zerogptChecked = "true";
          highlightSlopMarkers(container);
          const info = extractTweetInfo(container);
          
          // Local Prediction for Automatic Badging
          if (info.text && info.text.length > 20) {
            const prediction = ZeroSlopClassifier.predict(info.text);
            if (prediction) {
              const { label, probability, probabilities } = prediction;

              // Check if Smart Slop Guard is enabled
              chrome.storage.local.get(['autoHumanDetection'], (result) => {
                if (result.autoHumanDetection) {
                  if (label === 'slop-factory' && probability > 0.70) {
                    injectSmartSlopBadge(container, "SMART SLOP SIGNAL", "#ffd700", "#000");
                  } else if (label === 'ai-generated' && probability > 0.70) {
                    injectSmartSlopBadge(container, "SMART SLOP SIGNAL", "#ffd700", "#000");
                  }
                }
              });
            }
          }

          if (info.tweetId && !info.tweetId.startsWith('local-')) {
            // Add data attribute for easy lookup
            container.setAttribute('data-zerogpt-tweet-id', info.tweetId);

            // Layer 1: Community Shield - check registry (free, enabled by default)
            chrome.storage.local.get(['communityShield'], (shieldResult) => {
              if (shieldResult.communityShield !== false) {
                chrome.runtime.sendMessage({ action: "checkRegistry", tweetId: info.tweetId });
              }
            });

            // Layer 4: Auto-scan with ZeroGPT API (paid, opt-in)
            chrome.storage.local.get(['autoScan', 'adminOrganicCollection'], (result) => {
              if (result.autoScan || result.adminOrganicCollection) {
                chrome.runtime.sendMessage({
                  action: "autoScanTweet",
                  text: info.text,
                  tweetId: info.tweetId,
                  author: info.author
                });
              }
            });
            if (info.author?.handle) {
              chrome.runtime.sendMessage({ action: "checkSuspicious", handle: info.author.handle });
              chrome.runtime.sendMessage({ action: "checkSlopAccount", handle: info.author.handle });
            }
          }
        }

        if (container.getAttribute('data-testid') === 'UserCell' && !container.dataset.zerogptChecked) {
          container.dataset.zerogptChecked = "true";
          const handleEl = container.querySelector('span:nth-child(2)');
          if (handleEl && handleEl.innerText.startsWith('@')) {
            const handle = handleEl.innerText;
            chrome.runtime.sendMessage({ action: "checkSlopAccount", handle: handle });
            chrome.runtime.sendMessage({ action: "checkSuspicious", handle: handle });
          }
        }
      }
    });
  }, { threshold: 0.1 });

  const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.tagName === 'ARTICLE' || node.getAttribute('data-testid') === 'UserCell') {
            window.zerogptObserver.observe(node);
          } else {
            const newTargets = node.querySelectorAll('article, [data-testid="UserCell"]');
            newTargets.forEach(t => window.zerogptObserver.observe(t));
          }
        }
      });
    });
  });

  mutationObserver.observe(document.body, { childList: true, subtree: true });

  const retweetObserver = new MutationObserver((mutations) => {
    const path = window.location.pathname;
    if (path.includes('/retweets') || path.includes('/quotes')) {
      const match = path.match(/\/status\/(\d+)/);
      if (match) {
        const tweetId = match[1];
        chrome.runtime.sendMessage({ action: "checkRegistry", tweetId: tweetId }, (data) => {
          const factoryHandle = data?.author_handle;
          if (data && data.ai_score > 15) {
            const userCells = document.querySelectorAll('[data-testid="UserCell"]');
            userCells.forEach(cell => {
              const handleEl = cell.querySelector('span:nth-child(2)');
              if (handleEl && handleEl.innerText.startsWith('@')) {
                const handle = handleEl.innerText;
                const nameEl = cell.querySelector('span:nth-child(1)');
                const pfpEl = cell.querySelector('img');
                chrome.runtime.sendMessage({
                  action: "reportSuspicious",
                  handle: handle,
                  name: nameEl?.innerText,
                  pfp: pfpEl?.src,
                  tweetId: tweetId,
                  factoryHandle: factoryHandle
                });
              }
            });
          }
        });
      }
    }
  });
  retweetObserver.observe(document.body, { childList: true, subtree: true });

  const articles = document.querySelectorAll('article, [data-testid="UserCell"]');
  articles.forEach(el => window.zerogptObserver.observe(el));
}

function injectListAuditorButton() {
  if (document.getElementById('zerogpt-list-auditor')) return;
  const header = document.querySelector('[data-testid="primaryColumn"]');
  if (!header) return;

  const btn = document.createElement('button');
  btn.id = 'zerogpt-list-auditor';
  btn.innerText = '🕵️ Run Bounty Hunter Audit on this List';
  btn.style.cssText = `
    width: 100%;
    background: #1d9bf0;
    color: white;
    border: none;
    padding: 12px;
    font-weight: bold;
    cursor: pointer;
    border-bottom: 1px solid #2f3336;
    font-size: 14px;
    z-index: 10;
  `;

  btn.onclick = () => {
    const handles = Array.from(document.querySelectorAll('[data-testid="UserCell"] span:nth-child(2)'))
      .map(el => el.innerText)
      .filter(h => h.startsWith('@'));
    if (handles.length === 0) {
      alert("No handles detected yet. Scroll down to load more!");
      return;
    }
    const handleList = handles.join(',');
    window.open(`https://woodrock.github.io/zero-slop?audit=${handleList}`, '_blank');
  };
  header.prepend(btn);
}

function autoScanAmplifiers() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('zerogpt_scan') === 'true') {
    console.log("ZeroSlop: Bounty Hunter active. Scanning bot network...");
    
    let scanCount = 0;
    const scanInterval = setInterval(() => {
      const userCells = document.querySelectorAll('[data-testid="UserCell"]');
      if (userCells.length > 0 || scanCount > 15) {
        clearInterval(scanInterval);
        
        const match = window.location.pathname.match(/\/status\/(\d+)/);
        const tweetId = match ? match[1] : null;

        // Try to get handle from the page if possible (e.g. from the tweet being retweeted)
        let foundFactoryHandle = null;
        const authorEl = document.querySelector('[data-testid="User-Name"] a');
        if (authorEl && authorEl.innerText.startsWith('@')) {
          foundFactoryHandle = authorEl.innerText;
        }

        chrome.runtime.sendMessage({ action: "checkRegistry", tweetId: tweetId }, (regData) => {
          const factoryHandle = foundFactoryHandle || regData?.author_handle;

          userCells.forEach(cell => {
            const spans = cell.querySelectorAll('span');
            let handle = null;
            let name = null;
            
            // Twitter's UserCell usually has name in 1st/2nd span and handle in another
            spans.forEach(s => {
              if (s.innerText.startsWith('@')) handle = s.innerText;
            });

            if (handle) {
              const pfpEl = cell.querySelector('img');
              chrome.runtime.sendMessage({
                action: "reportSuspicious",
                handle: handle,
                name: name || handle,
                pfp: pfpEl?.src,
                tweetId: tweetId,
                factoryHandle: factoryHandle
              });
            }
          });
        });
        
        console.log(`ZeroSlop: Scanned ${userCells.length} potential bots. Mission complete.`);
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: "closeScanTab" });
        }, 1500);
      }
      scanCount++;
    }, 1000);
  }
}

async function generateWantedPoster(author, percentage) {
  if (!author) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 600;
  canvas.height = 800;
  ctx.fillStyle = '#f4e4bc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = 20;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  ctx.fillStyle = '#5d4037';
  ctx.font = 'bold 80px "Courier New", Courier, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('WANTED', canvas.width / 2, 120);
  ctx.font = 'bold 30px "Courier New", Courier, monospace';
  ctx.fillText('FOR SPREADING AI SLOP', canvas.width / 2, 160);
  if (author.pfp) {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = author.pfp;
      await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
      ctx.fillStyle = '#d7ccc8';
      ctx.fillRect(150, 200, 300, 300);
      ctx.drawImage(img, 150, 200, 300, 300);
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 5;
      ctx.strokeRect(150, 200, 300, 300);
    } catch (e) {}
  }
  ctx.fillStyle = '#5d4037';
  ctx.font = 'bold 40px "Courier New", Courier, monospace';
  ctx.fillText(author.name || 'Unknown Slop-Poster', canvas.width / 2, 560);
  ctx.font = 'italic 30px "Courier New", Courier, monospace';
  ctx.fillText(author.handle || '@anonymous', canvas.width / 2, 610);
  ctx.save();
  ctx.translate(canvas.width / 2, 400);
  ctx.rotate(-0.3);
  ctx.strokeStyle = 'rgba(244, 33, 46, 0.8)';
  ctx.lineWidth = 15;
  ctx.strokeRect(-250, -60, 500, 120);
  ctx.fillStyle = 'rgba(244, 33, 46, 0.8)';
  ctx.font = 'bold 70px Arial';
  ctx.fillText('AI SLOP', 0, 15);
  ctx.font = 'bold 30px Arial';
  ctx.fillText(`DETECTED: ${percentage}%`, 0, 45);
  ctx.restore();
  ctx.fillStyle = '#5d4037';
  ctx.font = 'bold 20px Arial';
  ctx.fillText('stamped by github.com/woodrock/zero-slop', canvas.width / 2, 750);
  return canvas.toBlob((blob) => {
    const item = new ClipboardItem({ "image/png": blob });
    navigator.clipboard.write([item]).then(() => { alert("Wanted Poster copied to clipboard! Share the truth. 🛡️"); });
  });
}

const SLOP_TYPES = [
  { 
    id: 'type_psych_burnout', 
    name: 'Burnout Exploit ($10k/mo)', 
    emoji: '🔥',
    description: 'Targets your exhaustion by selling a "magic button" solution to your problems.'
  },
  { 
    id: 'type_psych_imposter', 
    name: 'Imposter Panacea (No Skill)', 
    emoji: '🎓',
    description: 'Lowers the barrier to entry to make complex success seem easy for anyone.'
  },
  { 
    id: 'type_psych_paranoia', 
    name: 'Peer Paranoia (Get Ahead)', 
    emoji: '🕵️',
    description: 'Weaponizes the fear that your peers are getting ahead of you.'
  },
  { 
    id: 'type_psych_guilt', 
    name: 'Execution Guilt (7 Prompts)', 
    emoji: '✍️',
    description: 'Makes you feel like your lack of progress is just due to missing a "secret" prompt.'
  },
  { 
    id: 'type_algo_overload', 
    name: 'Cognitive Overload (20 Tools)', 
    emoji: '🧠',
    description: 'Overwhelms you with massive data dumps to force a "Save/Bookmark" action.'
  },
  { 
    id: 'type_algo_consensus', 
    name: 'Manufactured Consensus (Reply GPT)', 
    emoji: '🤖',
    description: 'Demands a specific keyword comment to trick the algorithm into seeing organic engagement.'
  },
  { 
    id: 'type_algo_curiosity', 
    name: 'Curiosity Gap (Show More)', 
    emoji: '🕳️',
    description: 'Hides the payload behind a "Show more" button to artificially increase dwell time.'
  },
  { 
    id: 'type_struct_math', 
    name: 'Math-Washing (Tool+Time=$)', 
    emoji: '🧮',
    description: 'Uses absurd, oversimplified equations to bypass your logical skepticism.'
  },
  { 
    id: 'type_struct_launder', 
    name: 'Institutional Launder (Harvard)', 
    emoji: '🏛️',
    description: 'Borrows the credibility of elite institutions to make generic tools seem high-end.'
  },
  { 
    id: 'type_struct_beta', 
    name: 'Beta-Tester Loophole', 
    emoji: '🧪',
    description: 'Uses "in testing" claims to brag about fake profits without making legal guarantees.'
  },
  { 
    id: 'type_visual_hijack', 
    name: 'IP Hijacking (Spider-Man)', 
    emoji: '🕷️',
    description: 'Uses pop-culture icons to distract you from uncanny AI artifacts and melting backgrounds.'
  },
  { id: 'type_organic_human', name: 'Verified Organic (Human)', emoji: '🌿', description: 'High-quality, organic human content. Use this to help train the model on what NOT to catch.' },
  ];

const UNIFIED_SLOP_RULES = [
  // --- Hard Blocks (Definitive Slop) ---
  { regex: /\bfollow\s+(me|@\w+)\b/gi, label: "Engagement Gate", description: "Clear signal of industrial audience capture.", points: 5 },
  { regex: /must follow/gi, label: "Engagement Gate", description: "Forced following to bypass algorithmic filters.", points: 5 },
  { regex: /\bcomment\b.{0,30}\bto (get|receive|join|access)\b/gi, label: "Comment Bait", description: "Tricks the algorithm into seeing organic engagement.", points: 5 },
  { regex: /\b(retweet|like\s+and\s+retweet)\b/gi, label: "Engagement Loop", description: "The most basic form of algorithmic currency extraction.", points: 5 },
  { regex: /\bbookmark\s+(this|it|now|thread|post)\b/gi, label: "Save/Bookmark Bait", description: "Exploits Miller's Law by overloading you with info to process now.", points: 5 },
  { regex: /\bsave\s+this\b/gi, label: "Save/Bookmark Bait", description: "Designed to increase post dwell-time and algorithmic 'saves'.", points: 5 },
  { regex: /\b(dm\s+me|dm\s+for|send\s+me\s+(a\s+)?dm)\b/gi, label: "Direct-Funnel Loop", description: "Moves the extraction into private messages to bypass public scrutiny.", points: 5 },
  { regex: /\$[\d,]+\+?\s*\/\s*(mo|month|day|week|hr|hour|year)/gi, label: "Income Claim", description: "Unverified financial promise designed to bypass logical skepticism.", points: 5 },
  { regex: /\$[\d,]+[k]?\s+per\s+(mo|month|day|week|hour)/gi, label: "Income Claim", description: "Specific, high-value financial hooks used by slop factories.", points: 5 },
  { regex: /\$[\d,]+.{0,40}(replac|instead of|consultant|lawyer|doctor|agency|degree|analyst|designer|copywriter)/gi, label: "Income Claim", description: "Claims that AI can replace high-value human professional services.", points: 5 },
  { regex: /\b(make|earn|generate|earning|making)\b.{0,20}\$[\d,]+/gi, label: "Income Claim", description: "Direct promises of unverified monetary gain.", points: 5 },
  { regex: /\b(money machine|cash machine|print money|income machine)\b/gi, label: "Hustle Buzzword", description: "Dehumanizes wealth generation into a mechanical, low-effort process.", points: 5 },
  { regex: /\bside\s+(hustle|income)\b/gi, label: "Aspirational Trap", description: "Targets workers with a fantasy of escaping the system.", points: 5 },
  { regex: /\bdata entry\b/gi, label: "Hustle Buzzword", description: "A common 'passive income' trope used to farm engagement.", points: 5 },
  { regex: /\bhere are\s+[1-9]\d*\b/gi, label: "List Formula", description: "Uses specific numbers to hack your brain's internal spam filter.", points: 5 },
  { regex: /\b[1-9]\d*\s+prompts?\b/gi, label: "Prompt List Formula", description: "Mass-produced prompt collections with low actual utility.", points: 5 },
  { regex: /\b[1-9]\d*\s+(tools?|hacks?|tricks?|ways?|tips?|secrets?|mistakes?|steps?)\b/gi, label: "List Formula", description: "Designed to provide 'value' that is just below the fold.", points: 5 },
  { regex: /\b(use these|try these|steal these|copy these)\b.{0,20}\b(prompts?|tools?|tricks?)\b/gi, label: "List Formula", description: "Encourages low-effort copy-pasting over genuine learning.", points: 5 },
  { regex: /\bact (as|like) (a |an )?(professional|expert|senior|world-class|harvard)/gi, label: "Institutional Launder", description: "Steals the credibility of elite brands to launder low-quality content.", points: 5 },
  { regex: /\bstep[\s-]by[\s-]step\b/gi, label: "List Formula", description: "Makes complex technology seem simple for the unqualified.", points: 5 },
  { regex: /\b[1-9]\d*\+?\s*free\s+(ai\s+)?courses?\b/gi, label: "Lead Magnet", description: "The 'value' is bait for a downstream product or newsletter.", points: 5 },
  // BREAKING: Only flag when followed by income/tool/free claims (not genuine news)
  { regex: /\bBREAKING\b.{0,80}(free|prompts?|\$[\d,]+|replac|for free|tool|hack|secret|cheat)/gi, label: "Clickbait Opener", description: "Artificially creates urgency to capture your initial scroll-speed.", points: 5 },
  { regex: /\bGOODBYE\b/g, label: "Clickbait Opener", description: "Uses finality to create a curiosity gap.", points: 5 },
  { regex: /\bR\.?I\.?P\.?\b/gi, label: "Clickbait Opener", description: "Uses fake finality to harvest engagement.", points: 5 },
  { regex: /\bSTOP (telling|using|doing|saying)\b/g, label: "Clickbait Opener", description: "Weaponizes authority to command your attention.", points: 5 },
  { regex: /\bCANCELLED\b.{0,60}(chatgpt|netflix|spotify|prime|subscription)/gi, label: "Clickbait Opener", description: "Exploits the fear of missing out on a 'magic button' solution.", points: 5 },
  { regex: /\b(most people don.t know|nobody (talks|is talking) about|very few (know|people)|hardly anyone|95% of people|99% of people)\b/gi, label: "Manufactured Consensus", description: "Weaponizes the fear that your peers are getting ahead of you.", points: 5 },
  { regex: /\bfor free\b/gi, label: "Lead Magnet", description: "Content is bait for a course blueprint or tool referral link.", points: 5 },
  { regex: /\bfaceless\b/gi, label: "Hustle Buzzword", description: "Promotes industrial content production without genuine intent.", points: 5 },
  { regex: /passive income/gi, label: "Hustle Buzzword", description: "Bait for a course blueprint or tool referral link.", points: 5 },
  { regex: /\bno (experience|skills?|coding|degree|team|budget|camera|luck)\b/gi, label: "Hustle Buzzword", description: "Lowers your critical guard by making success seem frictionless.", points: 5 },
  { regex: /\bzero to.{0,30}(income|money|\$)\b/gi, label: "Aspirational Trap", description: "The transformation story applied to a product or course funnel.", points: 5 },
  { regex: /\b(forget|ditch|quit|goodbye|replace)\s+chatgpt\b/gi, label: "Clickbait Opener", description: "Claims that all human work is replaceable by current AI wrappers.", points: 5 },
  { regex: /\b(giveaway|giving away)\b/gi, label: "Fake Giveaway", description: "Often a front for bot-network expansion.", points: 5 },
  { regex: /\b(prize|reward).{0,30}(follow|retweet|like|comment|enter)/gi, label: "Engagement Gate", description: "Engagement wall to harvest your account information.", points: 5 },
  { regex: /\bfree for \d+\s*hours?\b/gi, label: "Scarcity Bait", description: "Exploits the fear of missing out by creating fake time-pressure.", points: 5 },
  { regex: /\b(limited (spots?|seats?)|only \d+ spots?)\b/gi, label: "Scarcity Bait", description: "Uses specific, random numbers to make a scam look legitimate.", points: 5 },
  { regex: /\b(paid courses?).{0,30}free\b/gi, label: "Lead Magnet", description: "Fake pricing anchor to make slop look like a high-value gift.", points: 5 },
  { regex: /\ball paid.{0,20}free\b/gi, label: "Lead Magnet", description: "Designed to bypass your logical skepticism with 'free' value.", points: 5 },
  { regex: /\b(blueprint|masterclass|cheatsheet|playbook).{0,40}(free|get|dm|comment|follow)\b/gi, label: "Course Funnel", description: "Bait for a downstream product or tool referral link.", points: 5 },
  { regex: /\b(course|ebook|pdf).{0,40}\$[\d,]+\b/gi, label: "Course Funnel", description: "Direct monetization of engagement via informational products.", points: 5 },
  { regex: /\bgrok.{0,20}imagine\b/gi, label: "AI Promo", description: "Promotes AI tools using industrial engagement farming.", points: 5 },
  { regex: /\b(apob|pollo ai|seedance|heygen|synthesia)\b/gi, label: "AI Promo", description: "Specific tool promotions commonly found in slop networks.", points: 5 },
  { regex: /\bai\s+ugc\b/gi, label: "AI Promo", description: "Industrial content production disguised as organic user content.", points: 5 },
  { regex: /\bupload.{0,20}(photo|video|image).{0,40}(generate|create|make|turn into)\b/gi, label: "AI Promo", description: "Promotes AI creation tools through low-effort templates.", points: 5 },
  { regex: /\b(stop|still)\s+paying\s+for\b.{0,30}(storage|icloud|gmail|subscription)/gi, label: "Subscription Hook", description: "Targets your exhaustion with recurring fees to sell a 'magic button' solution.", points: 5 },
  { regex: /\bI\s+(found|discovered)\s+a\s+(way|secret|tool)\b/gi, label: "Curiosity Gap", description: "Claims of secret knowledge used to farm engagement.", points: 5 },
  { regex: /\b(I\s+)?hope\s+this\s+helps\s+you\s*↓/gi, label: "Engagement Ending", description: "Standardized call-to-action used in slop threads.", points: 5 },
  { regex: /\bstop\s+(declining|rejecting)\s+spam\s+calls\b/gi, label: "Fear-Based Hook", description: "Targets common annoyances with unverified solutions.", points: 5 },
  { regex: /\bif\s+your\s+iphone\s+gets\s+stolen\b/gi, label: "Fear-Based Hook", description: "Exploits anxiety about device security to extract attention.", points: 5 },
  { regex: /\b(most|9[59]% of)\s+(developers|students|people)\s+are\s+using\b.{0,30}\bwrong\b/gi, label: "Competence Gap", description: "Weaponizes the fear that you are falling behind your peers.", points: 5 },
  { regex: /\bsomeone\s+(built|leaked|compiled|just)\s+a\s+(tool|skill|system|repo|skill)\b/gi, label: "Third-Party Validation", description: "Uses fake institutional credibility to launder low-quality content.", points: 5 },
  { regex: /\b(your|a)\s+\$[\d,]+\s+camera\b.{0,50}\blosing\b/gi, label: "Comparison Hook", description: "Uses absurd gear comparisons to create scroll-stopping curiosity.", points: 5 },
  { regex: /\b(vibe\s+coding|claude\s+code|openclaw)\b/gi, label: "Trending Slop", description: "High-volume industrial farming of current AI keywords.", points: 5 },
  { regex: /\b(don.t|do\s+not)\s+change\s+the\s+iphone\b/gi, label: "Fear-Based Hook", description: "Uses fear of tech obsolescence to capture your scroll-speed.", points: 5 },
  { regex: /\bbest\s+for\s+(logic|writing|research|video)\b/gi, label: "Comparison Table", description: "Standardized AI model comparison templates used in slop.", points: 5 },

  // --- Soft Signals (Subtler Markers) ---
  { regex: /[\u{1D400}-\u{1D7FF}]/gu, label: "Bold Unicode Spam", description: "Uses custom characters to bypass filters and stand out visually.", points: 1 },
  { regex: /(changed my life|show more|read on|curiosity)/gi, label: "Curiosity Gap", description: "Exploits Loewenstein's Information Gap Theory to increase dwell time.", points: 0.5 },
  { regex: /\+.{0,20}\+.{0,20}=/g, label: "Math-Washing", description: "Weaponizes the Complexity Fallacy with oversimplified equations.", points: 1 }
];

const SLOP_HEURISTICS = {
  hardBlocks: UNIFIED_SLOP_RULES.filter(r => r.points >= 5),
  softSignals: UNIFIED_SLOP_RULES.filter(r => r.points < 5)
};


function highlightSlopMarkers(element) {
  if (!element) return;
  const tweetTextDiv = element.querySelector('[data-testid="tweetText"]');
  if (!tweetTextDiv || tweetTextDiv.dataset.hunterVision) return;
  chrome.storage.local.get(['hunterVision'], (result) => {
    if (!result.hunterVision) return;
    let html = tweetTextDiv.innerHTML;
    let text = tweetTextDiv.innerText;
    let found = false;
    let score = 0;
    const hour = new Date().getUTCHours();
    if (hour >= 0 && hour <= 7) score += 0.5;
    SLOP_HEURISTICS.hardBlocks.forEach(h => {
      if (h.regex.test(text)) {
        html = html.replace(h.regex, (match) => {
          found = true; score += 5;
          return `<span style="background: rgba(244, 33, 46, 0.25); border-bottom: 2px solid #f4212e; color: #f4212e; font-weight: bold; cursor: help;" title="${h.label}: ${h.description}">${match}</span>`;
        });
      }
    });
    SLOP_HEURISTICS.softSignals.forEach(s => {
      if (s.regex.test(text)) {
        html = html.replace(s.regex, (match) => {
          found = true; score += s.points;
          return `<span style="background: rgba(255, 215, 0, 0.15); border-bottom: 2px dashed #ffd700; color: #ffd700; cursor: help;" title="${s.label}: ${s.description}">${match}</span>`;
        });
      }
    });
    if (found) {
      tweetTextDiv.innerHTML = html;
      tweetTextDiv.dataset.hunterVision = "true";
      if (score >= 3) {
        const diagnostic = document.createElement('div');
        diagnostic.innerText = `🚩 Heuristic Slop Score: ${score.toFixed(1)}`;
        diagnostic.style.cssText = "font-size: 10px; color: #f4212e; margin-top: 4px; font-weight: bold; opacity: 0.8;";
        tweetTextDiv.parentElement.appendChild(diagnostic);
      }
    }
  });
}

function handleAutoAction(container, percentage) {
  chrome.storage.local.get(['slopAction', 'hideThreshold'], (result) => {
    const action = result.slopAction || 'blur';
    const threshold = result.hideThreshold !== undefined ? result.hideThreshold : 85;
    if (percentage >= threshold) {
      const contentDiv = container.querySelector('[data-testid="tweetText"]')?.parentElement;
      if (!contentDiv) return;
      if (action === 'zap') { 
        // 1. Initial "Snap" Pulse
        container.style.transition = 'none';
        container.style.animation = 'zerogptSnap 1.5s forwards ease-in-out';
        container.style.pointerEvents = 'none';
        
        // 2. Physical removal after animation finishes
        setTimeout(() => {
          container.style.display = 'none'; 
        }, 1500);
      } 
      else if (action === 'blur') {
        contentDiv.style.filter = 'blur(8px)';
        contentDiv.style.opacity = '0.6';
        contentDiv.style.transition = 'all 0.3s ease';
        contentDiv.style.cursor = 'pointer';
        contentDiv.title = 'Click to reveal AI Slop';
        contentDiv.addEventListener('click', function reveal() {
          contentDiv.style.filter = 'none';
          contentDiv.style.opacity = '1';
          contentDiv.style.cursor = 'default';
          contentDiv.title = '';
          contentDiv.removeEventListener('click', reveal);
        });
      }
    }
  });
}

async function runThanosSnap(element) {
  const rect = element.getBoundingClientRect();
  const canvas = await elementToCanvas(element);
  if (!canvas) {
    element.style.display = 'none';
    return;
  }

  // 1. Initial "Snap" Jitter
  element.style.transition = 'all 0.3s ease';
  element.style.transform = 'scale(1.05)';
  element.style.filter = 'brightness(1.5) blur(1px)';
  
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixelArr = imageData.data;
  
  // Create 32 layers for the "dust"
  const layerCount = 32;
  const layers = Array.from({ length: layerCount }, () => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    c.style.cssText = `
      position: absolute;
      left: ${rect.left + window.scrollX}px;
      top: ${rect.top + window.scrollY}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      pointer-events: none;
      z-index: 2147483646;
      transition: transform 1.5s ease-out, opacity 1.5s ease-out, filter 1.5s ease-out;
    `;
    return c;
  });

  // 2. Distribute pixels with a horizontal bias (the "Sweep")
  for (let i = 0; i < pixelArr.length; i += 4) {
    // Skip transparent pixels
    if (pixelArr[i+3] === 0) continue;

    const x = (i / 4) % width;
    const y = Math.floor((i / 4) / width);
    
    // Pick a layer based on X-coordinate + randomness to create a "trailing" edge
    const normalizedX = x / width;
    const layerIndex = Math.floor(layerCount * (normalizedX + (Math.random() - 0.5) * 0.5));
    const safeIndex = Math.max(0, Math.min(layerCount - 1, layerIndex));
    
    const layerCtx = layers[safeIndex].getContext('2d');
    layerCtx.fillStyle = `rgba(${pixelArr[i]}, ${pixelArr[i+1]}, ${pixelArr[i+2]}, ${pixelArr[i+3]/255})`;
    // Draw 2x2 particles for better visibility
    layerCtx.fillRect(x, y, 1.5, 1.5);
  }

  setTimeout(() => {
    // Hide real element
    element.style.opacity = '0';
    element.style.pointerEvents = 'none';
    
    layers.forEach((l, i) => {
      document.body.appendChild(l);
      
      // Force reflow
      l.offsetWidth; 
      
      // 3. The "Ash" Drift Physics
      // Stagger the start based on layer index (left-to-right sweep)
      const delay = i * 25; 
      setTimeout(() => {
        const angle = (Math.random() - 0.5) * 0.5; // Slight drift angle
        const driftX = 80 + Math.random() * 100;
        const driftY = -60 - Math.random() * 50;
        const rotate = (Math.random() - 0.5) * 30;
        
        l.style.transform = `translate(${driftX}px, ${driftY}px) rotate(${rotate}deg)`;
        l.style.opacity = '0';
        l.style.filter = 'blur(2px)';
      }, delay);

      // Cleanup
      setTimeout(() => {
        l.remove();
        if (i === layerCount - 1) {
          element.style.display = 'none';
        }
      }, 2000);
    });
  }, 300); // Wait for the initial "snap" jitter
}

function elementToCanvas(el) {
  return new Promise((resolve) => {
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (width === 0 || height === 0) return resolve(null);

    // Capture clone to avoid capturing the extension UI inside the element
    const clone = el.cloneNode(true);
    clone.style.width = width + 'px';
    clone.style.height = height + 'px';
    
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: sans-serif; color: white; background: transparent;">
            ${el.innerHTML.replace(/&nbsp;/g, ' ')}
          </div>
        </foreignObject>
      </svg>`;
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    img.onload = () => {
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function showOverlay(message, type = "info", currentAiScore = 0) {
  const existing = document.getElementById('zerogpt-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'zerogpt-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 60px;
    right: 20px;
    background: white;
    color: black;
    padding: 20px;
    border-radius: 12px;
    box-shadow: 0 10px 50px rgba(0,0,0,0.3);
    z-index: 2147483647;
    max-width: 320px;
    min-width: 250px;
    border-left: 8px solid ${type === 'error' ? '#f4212e' : type === 'success' ? '#1d9bf0' : '#ffd700'};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    animation: zerogptSlideIn 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    display: block !important;
  `;
  const title = document.createElement('div');
  title.innerText = type === 'error' ? "ZeroGPT Error" : type === 'success' ? "Detection Result" : "Processing...";
  title.style.fontWeight = '800';
  title.style.marginBottom = '12px';
  title.style.fontSize = '1.2rem';
  title.style.color = '#000';
  const content = document.createElement('div');
  content.innerText = message;
  content.style.whiteSpace = 'pre-wrap';
  content.style.fontSize = '1rem';
  content.style.lineHeight = '1.4';
  content.style.color = '#333';
  overlay.appendChild(title);
  overlay.appendChild(content);
  if (type === 'success') {
    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.flexDirection = 'column';
    btnContainer.style.gap = '8px';
    btnContainer.style.marginTop = '15px';
    
    try {
      const info = currentOverlayInfo || extractTweetInfo(lastRightClickedElement);
      if (!message.includes('Reported')) {
        let suggestedType = "";
        if (info?.text) {
          const text = info.text.toLowerCase();
          if (text.includes('$10k') || text.includes('10,000') || text.includes('60 minutes')) suggestedType = "type_psych_burnout";
          else if (text.includes('no skill') || text.includes('no luck')) suggestedType = "type_psych_imposter";
          else if (text.includes('20 tools') || text.includes('10 tools')) suggestedType = "type_algo_overload";
          else if (text.includes('comment') || text.includes('reply')) suggestedType = "type_algo_consensus";
          else if (text.includes('harvard') || text.includes('google') || text.includes('mckinsey')) suggestedType = "type_struct_launder";
          else if (text.includes('thread') || text.includes('🧵')) suggestedType = "type_algo_curiosity";
        }
        const reportBtn = document.createElement('button');
        reportBtn.innerText = '🚩 Report as AI Slop';
        reportBtn.style.cssText = `background: #f4212e; color: white; border: none; padding: 12px; border-radius: 20px; cursor: pointer; font-weight: bold; width: 100%; font-size: 0.95rem;`;
        const detailsDrawer = document.createElement('div');
        detailsDrawer.style.cssText = `display: none; background: #f7f9f9; border-radius: 12px; padding: 12px; border: 1px solid #e1e8ed; margin-top: 5px;`;
        const toggleDetails = document.createElement('div');
        toggleDetails.innerText = "Add Details (Optional) ▾";
        toggleDetails.style.cssText = "font-size: 0.75rem; color: #536471; cursor: pointer; text-align: center; margin-top: 4px; text-decoration: underline;";
        toggleDetails.onclick = () => {
          detailsDrawer.style.display = detailsDrawer.style.display === 'none' ? 'block' : 'none';
          toggleDetails.innerText = detailsDrawer.style.display === 'none' ? "Add Details (Optional) ▾" : "Hide Details ▴";
        };
        const slopSelect = document.createElement('select');
        slopSelect.style.cssText = "width: 100%; padding: 5px; border-radius: 6px; border: 1px solid #cfd9de; font-size: 0.8rem; margin-bottom: 6px;";
        const descBox = document.createElement('div');
        descBox.style.cssText = "font-size: 0.75rem; color: #536471; background: #fff; border: 1px solid #e1e8ed; padding: 8px; border-radius: 6px; margin-bottom: 10px; line-height: 1.3; display: none;";
        const defaultOpt = document.createElement('option');
        defaultOpt.value = ""; defaultOpt.text = "General Slop";
        slopSelect.appendChild(defaultOpt);
        SLOP_TYPES.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.id; opt.text = `${t.emoji} ${t.name}`;
          opt.title = t.description; // Tooltip on hover
          if (t.id === suggestedType) opt.selected = true;
          slopSelect.appendChild(opt);
        });
        const updateDesc = () => {
          const selected = SLOP_TYPES.find(t => t.id === slopSelect.value);
          if (selected) {
            descBox.innerText = selected.description;
            descBox.style.display = 'block';
          } else {
            descBox.style.display = 'none';
          }
        };
        slopSelect.onchange = updateDesc;
        if (suggestedType) updateDesc();
        detailsDrawer.appendChild(slopSelect);
        detailsDrawer.appendChild(descBox);
        const createCheck = (id, label) => {
          const div = document.createElement('label');
          div.style.cssText = "display: flex; align-items: center; gap: 6px; font-size: 0.75rem; margin-bottom: 4px; cursor: pointer;";
          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.id = id;
          div.appendChild(cb); div.appendChild(document.createTextNode(label));
          return { div, cb };
        };
        const check1 = createCheck('chk-acc', 'No accountable author');
        const check2 = createCheck('chk-fun', 'Contains funnel/CTA');
        const check3 = createCheck('chk-rep', 'Not replicable/Fake');
        detailsDrawer.appendChild(check1.div);
        detailsDrawer.appendChild(check2.div);
        detailsDrawer.appendChild(check3.div);
        const shieldLabel = document.createElement('div');
        shieldLabel.innerText = "Shield Type (Optional):";
        shieldLabel.style.cssText = "font-size: 0.75rem; font-weight: bold; margin-bottom: 5px; color: #536471; margin-top: 8px;";
        detailsDrawer.appendChild(shieldLabel);
        const shieldContainer = document.createElement('div');
        shieldContainer.style.cssText = "display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;";
        const createShieldOption = (id, label, color) => {
          const div = document.createElement('label');
          div.style.cssText = `display: flex; align-items: center; gap: 6px; font-size: 0.75rem; cursor: pointer; color: ${color}; font-weight: bold;`;
          const radio = document.createElement('input');
          radio.type = 'radio'; radio.name = 'shield-type'; radio.id = id; radio.value = id;
          div.appendChild(radio); div.appendChild(document.createTextNode(label));
          return { div, radio };
        };
        const optRed = createShieldOption('shield-red', '🚩 RED: Slop Factory', '#f4212e');
        const optBlue = createShieldOption('shield-blue', '🔵 BLUE: High AI Usage', '#1d9bf0');
        const optNone = createShieldOption('shield-none', '⚪ None (General Slop)', '#71767b');
        optNone.radio.checked = true;
        shieldContainer.appendChild(optRed.div);
        shieldContainer.appendChild(optBlue.div);
        shieldContainer.appendChild(optNone.div);
        detailsDrawer.appendChild(shieldContainer);
        reportBtn.onclick = () => {
          if (info) {
            const selectedShield = detailsDrawer.querySelector('input[name="shield-type"]:checked').value;
            chrome.runtime.sendMessage({
              action: "manualReport",
              aiScore: currentAiScore,
              slopType: slopSelect.value,
              extractionResults: { accountability: check1.cb.checked, funnel: check2.cb.checked, replicability: check3.cb.checked },
              shieldType: selectedShield,
              ...info
            });
            reportBtn.innerText = '✅ Reported to Registry';
            reportBtn.style.background = '#00ba7c';
            reportBtn.disabled = true; toggleDetails.remove(); detailsDrawer.remove();
          }
        };

        const safeBtn = document.createElement('button');
        safeBtn.innerText = '🌿 Mark as Organic (Human)';
        safeBtn.style.cssText = `background: #00ba7c; color: white; border: none; padding: 12px; border-radius: 20px; cursor: pointer; font-weight: bold; width: 100%; font-size: 0.95rem; margin-top: 5px;`;
        safeBtn.onclick = () => {
          if (info) {
            chrome.runtime.sendMessage({
              action: "manualReport",
              aiScore: 0,
              slopType: "type_organic_human",
              shieldType: "shield-green",
              ...info
            });
            safeBtn.innerText = '✅ Verified Organic';
            safeBtn.disabled = true;
            if (reportBtn) reportBtn.remove();
            toggleDetails.remove();
            detailsDrawer.remove();
          }
        };

        btnContainer.appendChild(toggleDetails);
        btnContainer.appendChild(detailsDrawer);
        btnContainer.appendChild(reportBtn);
        btnContainer.appendChild(safeBtn);
      }
      const posterBtn = document.createElement('button');
      posterBtn.innerText = '🖼️ Generate Wanted Poster';
      posterBtn.style.cssText = `background: #1d9bf0; color: white; border: none; padding: 10px; border-radius: 20px; cursor: pointer; font-weight: bold; width: 100%; font-size: 0.9rem;`;
      posterBtn.onclick = () => {
        if (info && info.author) {
          posterBtn.innerText = '⌛ Generating...';
          generateWantedPoster(info.author, currentAiScore).then(() => {
            posterBtn.innerText = '📋 Copied to Clipboard!';
            setTimeout(() => posterBtn.innerText = '🖼️ Generate Wanted Poster', 3000);
          });
        }
      };
      btnContainer.appendChild(posterBtn);
    } catch (e) {
      console.error("ZeroSlop: Error building overlay buttons", e);
    }
    overlay.appendChild(btnContainer);
  }
  const closeBtn = document.createElement('button');
  closeBtn.innerText = '✕';
  closeBtn.style.cssText = `position: absolute; top: 10px; right: 10px; background: #eee; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #555;`;
  closeBtn.onclick = () => overlay.remove();
  let isHovered = false;
  overlay.onmouseenter = () => { isHovered = true; };
  overlay.onmouseleave = () => { isHovered = false; };
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
  if (type !== 'error') {
    const timeoutDuration = type === 'success' ? 8000 : 4000;
    const attemptHide = () => {
      if (isHovered) { setTimeout(attemptHide, 2000); return; }
      if (overlay.parentNode) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.5s';
        setTimeout(() => overlay.remove(), 500);
      }
    };
    setTimeout(attemptHide, timeoutDuration);
  }
}

initObservers();
autoScanAmplifiers();
console.log("ZeroSlop: Content script v1.3.10 initialized.");

if (!document.getElementById('zerogpt-styles')) {
  const style = document.createElement('style');
  style.id = 'zerogpt-styles';
  style.textContent = `
    @keyframes zerogptSlideIn {
      from { transform: translateX(120%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes zerogptSnap {
      0% { 
        filter: blur(0) brightness(1) grayscale(0); 
        transform: scale(1) rotate(0);
        opacity: 1;
      }
      10% { 
        filter: blur(1px) brightness(1.5) grayscale(0.2); 
        transform: scale(1.05) rotate(0.5deg) translateX(-2px);
      }
      30% {
        filter: blur(3px) brightness(1.2) grayscale(0.5) sepia(0.5);
        transform: scale(1.02) rotate(-0.5deg) translateX(2px);
      }
      100% { 
        filter: blur(30px) brightness(0.5) grayscale(1) sepia(1) contrast(1.5);
        transform: scale(0.8) translate(200px, -100px) rotate(15deg) skew(20deg);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}