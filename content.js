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
    // 1. Get Text
    const tweetTextDiv = container.querySelector('[data-testid="tweetText"]');
    if (tweetTextDiv) {
      text = tweetTextDiv.innerText || tweetTextDiv.textContent;
    }

    // 2. Get Tweet ID from the time link (URL contains the ID)
    const timeLink = container.querySelector('time')?.parentElement;
    if (timeLink && timeLink.href) {
      const match = timeLink.href.match(/\/status\/(\d+)/);
      if (match) tweetId = match[1];
    }

    // 3. Get Author Info
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

    // Fallback ID
    if (!tweetId) {
      if (!container.dataset.zerogptId) {
        container.dataset.zerogptId = 'local-' + Math.random().toString(36).substr(2, 9);
      }
      tweetId = container.dataset.zerogptId;
    }

    return { text, tweetId, author };
  }

  // Fallback for selection-based checks
  const nearbyText = element ? element.closest('[data-testid="tweetText"]') : null;
  if (nearbyText) {
    text = nearbyText.innerText || nearbyText.textContent;
  }
  return { text, tweetId: null, author: null };
}

function injectBadge(tweetIdOrContainer, percentage) {
  let container;
  if (typeof tweetIdOrContainer === 'string') {
    container = document.querySelector(`[data-zerogpt-id="${tweetIdOrContainer}"]`) || 
                // Also look for it by matching the status link if it's a real ID
                document.querySelector(`article a[href*="/status/${tweetIdOrContainer}"]`)?.closest('article');
  } else {
    container = tweetIdOrContainer;
  }

  if (!container) return;

  // Avoid duplicate badges
  if (container.querySelector('.zerogpt-badge')) return;

  const badge = document.createElement('div');
  badge.className = 'zerogpt-badge';
  
  let color = '#17a2b8'; // Default info
  if (percentage > 70) color = '#dc3545'; // High AI -> Red
  else if (percentage < 30) color = '#28a745'; // Low AI -> Green
  else color = '#ffc107'; // Medium AI -> Yellow

  badge.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    margin-left: 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: bold;
    color: white;
    background-color: ${color};
    vertical-align: middle;
    line-height: 1;
    height: 16px;
    cursor: help;
  `;
  badge.innerText = `AI: ${percentage}%`;
  badge.title = 'ZeroGPT AI Detection Score';

  // Find a good place to inject. Usually next to the timestamp or username
  const timeElement = container.querySelector('time');
  if (timeElement && timeElement.parentNode) {
    timeElement.parentNode.appendChild(badge);
  } else {
    // Fallback: prepend to tweet text
    const textElement = container.querySelector('[data-testid="tweetText"]');
    if (textElement && textElement.parentNode) {
      // Create a wrapper to make it look decent
      const wrapper = document.createElement('div');
      wrapper.style.marginBottom = '4px';
      wrapper.appendChild(badge);
      textElement.parentNode.insertBefore(wrapper, textElement);
    }
  }
}

// Auto-scan feature: use IntersectionObserver to detect new tweets
chrome.storage.local.get(['autoScan'], (result) => {
  if (result.autoScan) {
    initAutoScan();
  }
});

// Listen for auto-scan toggle changes from popup
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.autoScan) {
    if (changes.autoScan.newValue) {
      initAutoScan();
    } else {
      if (window.zerogptObserver) {
        window.zerogptObserver.disconnect();
      }
    }
  }
});

function initAutoScan() {
  if (window.zerogptObserver) window.zerogptObserver.disconnect();
  
  window.zerogptObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const container = entry.target;
        if (!container.dataset.zerogptScanned) {
          container.dataset.zerogptScanned = "true";
          const info = extractTweetInfo(container);
          if (info.text && info.text.length > 20) { // Don't scan very short tweets
            chrome.runtime.sendMessage({
              action: "autoScanTweet",
              ...info
            });
          }
        }
      }
    });
  }, { threshold: 0.5 });

  // Observe existing tweets
  const articles = document.querySelectorAll('article');
  articles.forEach(el => window.zerogptObserver.observe(el));

  // MutationObserver to catch newly loaded tweets
  const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) { // ELEMENT_NODE
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
    border-left: 8px solid ${type === 'error' ? '#ff4b2b' : type === 'success' ? '#1d9bf0' : '#ffd700'};
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
  overlay.appendChild(content);
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