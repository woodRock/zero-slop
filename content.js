let lastRightClickedElement = null;

console.log("ZeroGPT Extension: Content script loaded.");

// Track right-click position to find the element
document.addEventListener('contextmenu', (event) => {
  lastRightClickedElement = event.target;
  console.log("ZeroGPT Extension: Target element updated", lastRightClickedElement);
}, true);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("ZeroGPT Extension: Message received", request.action);
  
  if (request.action === "getTweetText") {
    const tweetText = findTweetText(lastRightClickedElement);
    console.log("ZeroGPT Extension: Extracted text:", tweetText);
    sendResponse({ text: tweetText });
  } else if (request.action === "showLoader") {
    showOverlay("Analyzing text with ZeroGPT...");
  } else if (request.action === "showResult") {
    const data = request.data;
    const message = `AI Generation: ${data.fakePercentage || 0}%\n` +
                    `Status: ${data.feedback_message || "Analyzed"}\n` +
                    `Words: ${data.textWords || 0}`;
    showOverlay(message, "success");
  } else if (request.action === "showError") {
    showOverlay(request.message, "error");
  }
  return true; // Keep channel open for async response
});

function findTweetText(element) {
  if (!element) return null;

  // Search upwards for the tweet container
  let container = element.closest('article');
  if (!container) {
    // Try to find a common parent if it's a "focus" tweet
    container = element.closest('[data-testid="cellInnerDiv"]');
  }

  if (container) {
    const tweetTextDiv = container.querySelector('[data-testid="tweetText"]');
    if (tweetTextDiv) {
      return tweetTextDiv.innerText || tweetTextDiv.textContent;
    }
  }

  // Fallback: If we can't find the article, try to find any tweet text nearby
  const nearbyText = element.closest('[data-testid="tweetText"]');
  if (nearbyText) return nearbyText.innerText || nearbyText.textContent;

  return null;
}

function showOverlay(message, type = "info") {
  console.log(`ZeroGPT Extension: Showing ${type} overlay:`, message);
  
  const existing = document.getElementById('zerogpt-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'zerogpt-overlay';
  
  // Maximize z-index to ensure it's above Twitter's layers
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
    visibility: visible !important;
    opacity: 1 !important;
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
    const timeout = type === 'success' ? 10000 : 4000;
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.5s';
        setTimeout(() => overlay.remove(), 500);
      }
    }, timeout);
  }
}

// Add animation style if not exists
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
