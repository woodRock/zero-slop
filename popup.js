document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const autoScanToggle = document.getElementById('autoScanToggle');
  const hunterVisionToggle = document.getElementById('hunterVisionToggle');
  const smartSlopGuardToggle = document.getElementById('autoHumanDetectionToggle');
  const slopAction = document.getElementById('slopAction');
  const thresholdSlider = document.getElementById('thresholdSlider');
  const thresholdVal = document.getElementById('thresholdVal');
  const exportBtn = document.getElementById('exportBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const historyList = document.getElementById('historyList');
  const slopsCaughtCountEl = document.getElementById('slopsCaughtCount');
  
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
  chrome.storage.local.get(['zerogptApiKey', 'autoScan', 'slopAction', 'hideThreshold', 'scanHistory', 'slopsCaught', 'hunterVision', 'autoHumanDetection'], (result) => {
    if (result.zerogptApiKey) {
      apiKeyInput.value = result.zerogptApiKey;
      statusEl.textContent = 'API Key is already set.';
      statusEl.className = 'status success';
    }
    if (result.autoScan) {
      autoScanToggle.checked = true;
    }
    if (result.hunterVision) {
      hunterVisionToggle.checked = true;
    }
    if (result.autoHumanDetection) {
      smartSlopGuardToggle.checked = true;
    }
    if (result.slopAction) {
      slopAction.value = result.slopAction;
    }
    if (result.hideThreshold !== undefined) {
      thresholdSlider.value = result.hideThreshold;
      thresholdVal.textContent = result.hideThreshold;
    }
    if (result.slopsCaught) {
      slopsCaughtCountEl.textContent = result.slopsCaught;
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

  // Toggle hunter vision
  hunterVisionToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ hunterVision: e.target.checked });
  });

  // Toggle auto human detection (now Smart Slop Guard)
  smartSlopGuardToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ autoHumanDetection: e.target.checked });
  });

  // Update slop action
  slopAction.addEventListener('change', (e) => {
    chrome.storage.local.set({ slopAction: e.target.value });
  });

  // Update threshold
  thresholdSlider.addEventListener('input', (e) => {
    thresholdVal.textContent = e.target.value;
    chrome.storage.local.set({ hideThreshold: parseInt(e.target.value, 10) });
  });

  // Toggle advanced settings
  const advancedToggle = document.getElementById('advancedToggle');
  const advancedContent = document.getElementById('advancedContent');
  advancedToggle.addEventListener('click', () => {
    advancedContent.classList.toggle('show');
    advancedToggle.innerText = advancedContent.classList.contains('show') ? '⚙️ Advanced Settings ▴' : '⚙️ Advanced Settings ▾';
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
});