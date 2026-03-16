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
  }
  return true; 
});

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
  badge.innerText = '⚠️ POTENTIAL BOT';
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

/**
 * Finds all visible tweets by the same author and combines their text
 */
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

/**
 * Specifically finds all visible tweets on a profile page or by an author
 */
function extractProfileInfo(element) {
  const currentTweetInfo = extractTweetInfo(element);
  let targetHandle = currentTweetInfo.author?.handle;

  // If we are on a profile page but didn't click a tweet, try to get handle from URL
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

  // Task 6: Registry Auto-Cleanup
  // Ignore or hide badges where downvotes > upvotes + 2
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

  // Handle Auto-Hide
  chrome.storage.local.get(['autoHide', 'hideThreshold'], (result) => {
    const autoHide = result.autoHide || false;
    const hideThreshold = result.hideThreshold !== undefined ? result.hideThreshold : 85;
    
    if (autoHide && percentage >= hideThreshold) {
      const contentDiv = container.querySelector('[data-testid="tweetText"]')?.parentElement;
      if (contentDiv) {
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

function initObservers() {
  if (window.zerogptObserver) window.zerogptObserver.disconnect();

  // Profile Warning Detection
  const checkProfileWarning = () => {
    const path = window.location.pathname;
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 1 && !['home', 'explore', 'notifications', 'messages', 'search', 'settings'].includes(parts[0])) {
      const handle = '@' + parts[0];
      chrome.runtime.sendMessage({ action: "checkProfileSlop", handle: handle });
      chrome.runtime.sendMessage({ action: "checkSuspicious", handle: handle });
    }
  };
  
  // Initial check
  checkProfileWarning();
  
  // Re-check on navigation (Twitter is a SPA)
  let lastPath = window.location.pathname;
  const navObserver = new MutationObserver(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      checkProfileWarning();
      // Remove any existing banners on new page
      const profileBanner = document.getElementById('zerogpt-profile-banner');
      if (profileBanner) profileBanner.remove();
      const suspiciousBanner = document.getElementById('zerogpt-suspicious-banner');
      if (suspiciousBanner) suspiciousBanner.remove();
    }
  });
  navObserver.observe(document.head, { childList: true, subtree: true });

  window.zerogptObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const container = entry.target;
        if (!container.dataset.zerogptChecked) {
          container.dataset.zerogptChecked = "true";
          const info = extractTweetInfo(container);
          if (info.tweetId && !info.tweetId.startsWith('local-')) {
            chrome.runtime.sendMessage({ action: "checkRegistry", tweetId: info.tweetId });
            chrome.storage.local.get(['autoScan'], (result) => {
              if (result.autoScan) {
                chrome.runtime.sendMessage({ action: "autoScanTweet", ...info });
              }
            });
            
            // Check if author is suspicious
            if (info.author?.handle) {
              chrome.runtime.sendMessage({ action: "checkSuspicious", handle: info.author.handle });
            }
          }
        }
      }
    });
  }, { threshold: 0.1 });

  // Special Observer for Retweets/Quotes Modal
  const retweetObserver = new MutationObserver((mutations) => {
    const path = window.location.pathname;
    if (path.includes('/retweets') || path.includes('/quotes')) {
      const match = path.match(/\/status\/(\d+)/);
      if (match) {
        const tweetId = match[1];
        // Only scrape if the parent tweet is a confirmed slop tweet
        chrome.runtime.sendMessage({ action: "checkRegistry", tweetId: tweetId }, (data) => {
          if (data && data.ai_score > 70) {
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
                  tweetId: tweetId
                });
              }
            });
          }
        });
      }
    }
  });

  const articles = document.querySelectorAll('article');
  articles.forEach(el => window.zerogptObserver.observe(el));

  const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.tagName === 'ARTICLE') {
            window.zerogptObserver.observe(node);
          } else {
            const newArticles = node.querySelectorAll('article');
            newArticles.forEach(article => window.zerogptObserver.observe(article));
          }
        }
      });
    });
  });

  mutationObserver.observe(document.body, { childList: true, subtree: true });
  retweetObserver.observe(document.body, { childList: true, subtree: true });
}

initObservers();

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
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });
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
    navigator.clipboard.write([item]).then(() => {
      alert("Wanted Poster copied to clipboard! Share the truth. 🛡️");
    });
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

    // Use the stored info from the global, or fallback to current extraction
    const info = currentOverlayInfo || extractTweetInfo(lastRightClickedElement);

    if (!message.includes('Reported')) {
      const reportBtn = document.createElement('button');
      reportBtn.innerText = '🚩 Report as AI Slop';
      reportBtn.style.cssText = `
        background: #f4212e;
        color: white;
        border: none;
        padding: 10px;
        border-radius: 20px;
        cursor: pointer;
        font-weight: bold;
        width: 100%;
        font-size: 0.9rem;
      `;
      reportBtn.onclick = () => {
        if (info) {
          chrome.runtime.sendMessage({
            action: "manualReport",
            aiScore: currentAiScore,
            ...info
          });
          reportBtn.innerText = '✅ Reported to Registry';
          reportBtn.style.background = '#00ba7c';
          reportBtn.disabled = true;
        }
      };
      btnContainer.appendChild(reportBtn);
    }

    const posterBtn = document.createElement('button');
    posterBtn.innerText = '🖼️ Generate Wanted Poster';
    posterBtn.style.cssText = `
      background: #1d9bf0;
      color: white;
      border: none;
      padding: 10px;
      border-radius: 20px;
      cursor: pointer;
      font-weight: bold;
      width: 100%;
      font-size: 0.9rem;
    `;
    posterBtn.onclick = () => {
      if (info && info.author) {
        posterBtn.innerText = '⌛ Generating...';
        generateWantedPoster(info.author, currentAiScore).then(() => {
          posterBtn.innerText = '📋 Copied to Clipboard!';
          setTimeout(() => posterBtn.innerText = '🖼️ Generate Wanted Poster', 3000);
        });
      }
    };    btnContainer.appendChild(posterBtn);
    overlay.appendChild(btnContainer);
  }

  const closeBtn = document.createElement('button');
  closeBtn.innerText = '✕';
  closeBtn.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    background: #eee;
    border: none;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    color: #555;
  `;
  closeBtn.onclick = () => overlay.remove();

  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);

  if (type !== 'error') {
    const timeout = type === 'success' ? 8000 : 4000;
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.5s';
        setTimeout(() => overlay.remove(), 500);
      }
    }, timeout);
  }
}

if (!document.getElementById('zerogpt-styles')) {
  const style = document.createElement('style');
  style.id = 'zerogpt-styles';
  style.textContent = `
    @keyframes zerogptSlideIn {
      from { transform: translateX(120%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}