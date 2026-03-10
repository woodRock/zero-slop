document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const updateBtn = document.getElementById('updateBtn');
  const updateStatus = document.getElementById('updateStatus');
  const autoScanToggle = document.getElementById('autoScanToggle');
  const exportBtn = document.getElementById('exportBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const historyList = document.getElementById('historyList');

  const repoUrl = 'https://github.com/woodRock/zero-slop';
  const rawManifestUrl = 'https://raw.githubusercontent.com/woodRock/zero-slop/main/manifest.json';

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.target).classList.add('active');
    });
  });

  // Load state
  chrome.storage.local.get(['zerogptApiKey', 'autoScan', 'scanHistory'], (result) => {
    if (result.zerogptApiKey) {
      apiKeyInput.value = result.zerogptApiKey;
      statusEl.textContent = 'API Key is already set.';
      statusEl.className = 'status success';
    }
    if (result.autoScan) {
      autoScanToggle.checked = true;
    }
    renderHistory(result.scanHistory || []);
  });

  // Save new API key
  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      chrome.storage.local.set({ zerogptApiKey: apiKey }, () => {
        statusEl.textContent = 'API Key saved successfully!';
        statusEl.className = 'status success';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
      });
    } else {
      statusEl.textContent = 'Please enter a valid API key.';
      statusEl.className = 'status error';
    }
  });

  // Toggle auto-scan
  autoScanToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ autoScan: e.target.checked });
  });

  // Render history
  function renderHistory(history) {
    historyList.innerHTML = '';
    if (history.length === 0) {
      historyList.innerHTML = '<div style="color: #999; text-align: center; padding: 10px;">No history yet.</div>';
      return;
    }
    history.slice().reverse().forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const textDiv = document.createElement('div');
      textDiv.className = 'history-text';
      textDiv.textContent = item.text;
      textDiv.title = item.text;
      const scoreDiv = document.createElement('div');
      scoreDiv.className = 'history-score';
      scoreDiv.textContent = `${item.percentage}% AI`;
      div.appendChild(textDiv);
      div.appendChild(scoreDiv);
      historyList.appendChild(div);
    });
  }

  // Clear history
  clearHistoryBtn.addEventListener('click', () => {
    chrome.storage.local.set({ scanHistory: [] }, () => {
      renderHistory([]);
    });
  });

  // Export history
  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(['scanHistory'], (result) => {
      const history = result.scanHistory || [];
      if (history.length === 0) return alert('No history to export.');
      
      let csv = 'Timestamp,Text,AI Percentage,Words\n';
      history.forEach(item => {
        const text = item.text.replace(/"/g, '""'); // Escape quotes
        csv += `${item.timestamp},"${text}",${item.percentage},${item.words}\n`;
      });
      
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'zerogpt_history.csv';
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  // Check for updates
  updateBtn.addEventListener('click', async () => {
    updateStatus.textContent = 'Checking GitHub...';
    updateStatus.className = 'status';
    try {
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
      updateStatus.textContent = 'Could not fetch from GitHub. Ensure your internet is connected and the repo is public.';
      updateStatus.className = 'status error';
    }
  });
});