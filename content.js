let lastRightClickedElement = null;

// Track right-click position to find the element
document.addEventListener('contextmenu', (event) => {
  lastRightClickedElement = event.target;
}, true);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getTweetText") {
    const info = extractTweetInfo(lastRightClickedElement);
    sendResponse(info);
  } else if (request.action === "showLoader") {
    showOverlay("Analyzing text with ZeroGPT...");
  } else if (request.action === "showResult") {
    const data = request.data;
    const isAutoScan = request.isAutoScan;
    
    if (!isAutoScan) {
      const message = `AI Generation: ${data.fakePercentage || 0}%\n` +
                      `Status: ${data.feedback_message || "Analyzed"}\n` +
                      `Words: ${data.textWords || 0}`;
      showOverlay(message, "success");
    }
    
    // Always try to inject a badge if we have a tweetId or last right-clicked context
    injectBadge(request.tweetId || getTweetContainer(lastRightClickedElement), data.fakePercentage || 0);
  } else if (request.action === "showError") {
    showOverlay(request.message, "error");
  }
  return true; // Keep channel open for async response
});

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
        if (link.innerText.startsWith('@')) {
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

function injectBadge(tweetIdOrContainer, percentage) {
  let container;
  if (typeof tweetIdOrContainer === 'string') {
    container = document.querySelector(`article a[href*="/status/${tweetIdOrContainer}"]`)?.closest('article') ||
                document.querySelector(`[data-zerogpt-id="${tweetIdOrContainer}"]`);
  } else {
    container = tweetIdOrContainer;
  }

  if (!container || container.querySelector('.zerogpt-badge')) return;

  const badge = document.createElement('div');
  badge.className = 'zerogpt-badge';
  
  let color = '#17a2b8';
  if (percentage > 70) color = '#f4212e'; // Twitter Red
  else if (percentage < 30) color = '#00ba7c'; // Twitter Green
  else color = '#ffd700'; // Yellow

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
  badge.innerText = `AI: ${percentage}%`;
  badge.title = 'ZeroSlop Registry Score';

  const timeElement = container.querySelector('time');
  if (timeElement && timeElement.parentNode) {
    timeElement.parentNode.appendChild(badge);
  }
}

// Registry Check & Auto-Scan
function initObservers() {
  if (window.zerogptObserver) window.zerogptObserver.disconnect();
  
  window.zerogptObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const container = entry.target;
        if (!container.dataset.zerogptChecked) {
          container.dataset.zerogptChecked = "true";
          const info = extractTweetInfo(container);
          
          if (info.tweetId && !info.tweetId.startsWith('local-')) {
            // 1. Always check the registry first (SponsorBlock style)
            chrome.runtime.sendMessage({ action: "checkRegistry", tweetId: info.tweetId });
            
            // 2. If autoScan is ON, perform a fresh detection ONLY IF the registry check fails 
            // (handled in background.js or by simply running both)
            chrome.storage.local.get(['autoScan'], (result) => {
              if (result.autoScan) {
                chrome.runtime.sendMessage({ action: "autoScanTweet", ...info });
              }
            });
          }
        }
      }
    });
  }, { threshold: 0.1 });

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
}

// Start observing
initObservers();

function showOverlay(message, type = "info") {
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

  if (type === 'success' && !message.includes('Reported')) {
    const reportBtn = document.createElement('button');
    reportBtn.innerText = '🚩 Report as AI Slop';
    reportBtn.style.cssText = `
      margin-top: 15px;
      background: #f4212e;
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 20px;
      cursor: pointer;
      font-weight: bold;
      width: 100%;
      font-size: 0.9rem;
    `;
    reportBtn.onclick = () => {
      const info = extractTweetInfo(lastRightClickedElement);
      chrome.runtime.sendMessage({ action: "manualReport", ...info });
      reportBtn.innerText = '✅ Reported to Registry';
      reportBtn.style.background = '#00ba7c';
      reportBtn.disabled = true;
    };
    overlay.appendChild(content);
    overlay.appendChild(reportBtn);
  } else {
    overlay.appendChild(content);
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
  overlay.appendChild(title);
  document.body.appendChild(overlay);

  if (type !== 'error') {
    const timeout = type === 'success' ? 5000 : 4000;
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