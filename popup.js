document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const updateBtn = document.getElementById('updateBtn');
  const updateStatus = document.getElementById('updateStatus');

  const repoUrl = 'https://github.com/woodRock/zero-slop';
  const rawManifestUrl = 'https://raw.githubusercontent.com/woodRock/zero-slop/main/manifest.json';

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

  // Check for updates on GitHub
  updateBtn.addEventListener('click', async () => {
    updateStatus.textContent = 'Checking GitHub...';
    updateStatus.className = 'status';
    
    try {
      // Add timestamp to avoid caching
      const response = await fetch(`${rawManifestUrl}?t=${Date.now()}`);
      if (!response.ok) throw new Error('Network error');
      
      const remoteManifest = await response.json();
      const localVersion = chrome.runtime.getManifest().version;

      if (remoteManifest.version !== localVersion) {
        updateStatus.innerHTML = `New version <b>${remoteManifest.version}</b> available! <br><a href="${repoUrl}" target="_blank" style="color: #1d9bf0;">Click here to pull changes from GitHub</a>.`;
        updateStatus.className = 'status success';
      } else {
        updateStatus.textContent = `You are on the latest version (${localVersion}).`;
        updateStatus.className = 'status success';
      }
    } catch (e) {
      console.error('Update Check Failed:', e);
      updateStatus.textContent = 'Could not fetch from GitHub. Ensure your internet is connected and the repo is public.';
      updateStatus.className = 'status error';
    }
  });
});
