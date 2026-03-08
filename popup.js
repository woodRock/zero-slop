document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');

  // Load existing API key
  chrome.storage.local.get(['zerogptApiKey'], (result) => {
    if (result.zerogptApiKey) {
      apiKeyInput.value = result.zerogptApiKey;
      statusEl.textContent = 'API Key is already set.';
      statusEl.className = 'status success';
    }
  });

  // Save new API key
  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      chrome.storage.local.set({ zerogptApiKey: apiKey }, () => {
        statusEl.textContent = 'API Key saved successfully!';
        statusEl.className = 'status success';
        setTimeout(() => {
          statusEl.textContent = '';
        }, 3000);
      });
    } else {
      statusEl.textContent = 'Please enter a valid API key.';
      statusEl.className = 'status error';
    }
  });
});
