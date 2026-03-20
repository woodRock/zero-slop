let lastRightClickedElement = null;

// Track right-click position to find the element
document.addEventListener('contextmenu', (event) => {
  lastRightClickedElement = event.target;
}, true);

// Global to store the last detection result for the current tweet/profile
let currentOverlayInfo = null;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

function extractTweetInfo(element) {
  const container = getTweetContainer(element);
  let text = null;
  let tweetId = null;
  let author = { name: null, handle: null, pfp: null };
  
  if (container) {
    const tweetTextDiv = container.querySelector('[data-testid="tweetText"]');
    if (tweetTextDiv) {
      text = tweetTextDiv.innerText || tweetTextDiv.textContent;
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

    if (!tweetId) {
      if (!container.dataset.zerogptId) {
        container.dataset.zerogptId = 'local-' + Math.random().toString(36).substr(2, 9);
      }
      tweetId = container.dataset.zerogptId;
    }

    return { text, tweetId, author };
  }

  const nearbyText = element ? element.closest('[data-testid="tweetText"]') : null;
  if (nearbyText) {
    text = nearbyText.innerText || nearbyText.textContent;
  }
  return { text, tweetId: null, author: null };
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

function initObservers() {
  if (window.zerogptObserver) window.zerogptObserver.disconnect();

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
          if (info.tweetId && !info.tweetId.startsWith('local-')) {
            chrome.runtime.sendMessage({ action: "checkRegistry", tweetId: info.tweetId });
            chrome.storage.local.get(['autoScan'], (result) => {
              if (result.autoScan) chrome.runtime.sendMessage({ action: "autoScanTweet", ...info });
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
    let scanCount = 0;
    const scanInterval = setInterval(() => {
      const userCells = document.querySelectorAll('[data-testid="UserCell"]');
      if (userCells.length > 0 || scanCount > 10) {
        clearInterval(scanInterval);
        const match = window.location.pathname.match(/\/status\/(\d+)/);
        const tweetId = match ? match[1] : null;
        chrome.runtime.sendMessage({ action: "checkRegistry", tweetId: tweetId }, (regData) => {
          const factoryHandle = regData?.author_handle;
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
        });
        setTimeout(() => { chrome.runtime.sendMessage({ action: "closeScanTab" }); }, 1000);
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
  { id: 'type1', name: 'Type 1: Prompt-List Hustle', emoji: '🧵' },
  { id: 'type2', name: 'Type 2: Passive Income Pitch', emoji: '💰' },
  { id: 'type3', name: 'Type 3: Social Proof Fabrication', emoji: '🧪' },
  { id: 'type4', name: 'Type 4: Evergreen Re-publisher', emoji: '🔄' },
  { id: 'type5', name: 'Type 5: Personal Transformation', emoji: '🦋' },
];

const SLOP_HEURISTICS = {
  hardBlocks: [
    { regex: /follow.{0,40}(dm|send)/gi, label: "Follow-for-DM Loop" },
    { regex: /comment ["']?\w+/gi, label: "Comment Trigger" },
    { regex: /free for \d+ (hour|day|hr)/gi, label: "Scarcity Bait" },
    { regex: /must (follow|be following)/gi, label: "Gated Content" },
    { regex: /\$[\d,]+.{0,15}(per day|per month|\/day|\/month|\/week|\/hr)/gi, label: "Income Claim" },
    { regex: /(giveaway|cash giveaway|paypal cash)/gi, label: "Fake Giveaway" },
    { regex: /faceless (youtube|channel)/gi, label: "YouTube Hustle" },
    { regex: /normally.{0,15}\$/gi, label: "False Pricing" }
  ],
  softSignals: [
    { regex: /(like).{0,30}(repost|rt|retweet)/gi, points: 1, label: "Engagement Loop" },
    { regex: /^breaking:/gi, points: 1, label: "Clickbait Opener" },
    { regex: /no (coding|skills|experience|face|camera|editing)/gi, points: 1, label: "Hustle Buzzwords" },
    { regex: /[\u{1D400}-\u{1D7FF}]/gu, points: 1, label: "Bold Unicode Spam" },
    { regex: /(save (this|for later)|bookmark this)/gi, points: 0.5, label: "Save/Bookmark Bait" }
  ]
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
          return `<span style="background: rgba(244, 33, 46, 0.25); border-bottom: 2px solid #f4212e; color: #f4212e; font-weight: bold;" title="HARD BLOCK: ${h.label}">${match}</span>`;
        });
      }
    });
    SLOP_HEURISTICS.softSignals.forEach(s => {
      if (s.regex.test(text)) {
        html = html.replace(s.regex, (match) => {
          found = true; score += s.points;
          return `<span style="background: rgba(255, 215, 0, 0.15); border-bottom: 2px dashed #ffd700; color: #ffd700;" title="SOFT SIGNAL: ${s.label} (+${s.points} pts)">${match}</span>`;
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
        container.style.animation = 'zerogptSnap 0.8s forwards ease-in';
        container.style.pointerEvents = 'none';
        setTimeout(() => {
          container.style.display = 'none'; 
        }, 800);
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
    const info = currentOverlayInfo || extractTweetInfo(lastRightClickedElement);
    if (!message.includes('Reported')) {
      let suggestedType = "";
      if (info?.text) {
        const text = info.text.toLowerCase();
        if (text.includes('thread') || text.includes('🧵')) suggestedType = "type1";
        else if (text.includes('passive income') || text.includes('faceless')) suggestedType = "type2";
        else if (text.includes('my cousin') || text.includes('replies in')) suggestedType = "type3";
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
      slopSelect.style.cssText = "width: 100%; padding: 5px; border-radius: 6px; border: 1px solid #cfd9de; font-size: 0.8rem; margin-bottom: 10px;";
      const defaultOpt = document.createElement('option');
      defaultOpt.value = ""; defaultOpt.text = "General Slop";
      slopSelect.appendChild(defaultOpt);
      SLOP_TYPES.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id; opt.text = `${t.emoji} ${t.name}`;
        if (t.id === suggestedType) opt.selected = true;
        slopSelect.appendChild(opt);
      });
      detailsDrawer.appendChild(slopSelect);
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
      btnContainer.appendChild(toggleDetails);
      btnContainer.appendChild(detailsDrawer);
      btnContainer.appendChild(reportBtn);
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
        filter: blur(0) brightness(1); 
        transform: scale(1);
      }
      10% { 
        filter: blur(1px) brightness(1.2); 
        transform: translateX(-2px) rotate(-0.5deg);
      }
      20% {
        filter: blur(2px) brightness(1.5);
        transform: translateX(2px) rotate(0.5deg);
      }
      100% { 
        filter: blur(20px) brightness(0.8) sepia(1) contrast(1.2) hue-rotate(-30deg);
        transform: scale(0.9) translate(150px, -60px) rotate(-10deg) skew(20deg);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}