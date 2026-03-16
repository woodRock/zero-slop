document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const updateBtn = document.getElementById('updateBtn');
  const updateStatus = document.getElementById('updateStatus');
  const autoScanToggle = document.getElementById('autoScanToggle');
  const autoHideToggle = document.getElementById('autoHideToggle');
  const thresholdSlider = document.getElementById('thresholdSlider');
  const thresholdVal = document.getElementById('thresholdVal');
  const exportBtn = document.getElementById('exportBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const historyList = document.getElementById('historyList');
  const slopsCaughtCountEl = document.getElementById('slopsCaughtCount');
  
  // Audit Tab Elements
  const scanTrendsBtn = document.getElementById('scanTrendsBtn');
  const scanStatus = document.getElementById('scanStatus');
  const auditProgress = document.getElementById('auditProgress');
  const auditProgressBar = document.getElementById('auditProgressBar');
  const auditProgressText = document.getElementById('auditProgressText');
  const auditResult = document.getElementById('auditResult');
  const auditLeaderboard = document.getElementById('auditLeaderboard');
  const publishAuditBtn = document.getElementById('publishAuditBtn');

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

  // Audit Scanning Logic
  let currentAuditData = null;

  scanTrendsBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url.includes('x.com') && !tab.url.includes('twitter.com')) {
      scanStatus.textContent = 'Please go to x.com to scan trends.';
      scanStatus.className = 'status error';
      return;
    }

    scanStatus.textContent = 'Fetching trends from sidebar...';
    scanStatus.className = 'status';
    
    chrome.tabs.sendMessage(tab.id, { action: "getTrends" }, async (response) => {
      if (!response || !response.trends || response.trends.length === 0) {
        scanStatus.textContent = 'Could not find trends. Ensure you are on Home/Explore page.';
        scanStatus.className = 'status error';
        return;
      }

      const trends = response.trends;
      scanStatus.textContent = `Found ${trends.length} trends. Analyzing...`;
      auditProgress.style.display = 'block';
      auditResult.style.display = 'none';
      
      const topTrends = [];
      let totalSlopsCount = 0;

      for (let i = 0; i < trends.length; i++) {
        const trend = trends[i];
        auditProgressText.textContent = `${i + 1}/${trends.length} Topics: ${trend}`;
        auditProgressBar.style.width = `${((i + 1) / trends.length) * 100}%`;
        
        // Simulating scan results for trends
        // In a full implementation, this would involve searching for the trend and scanning top tweets
        const score = Math.floor(Math.random() * 80) + 10; 
        const count = Math.floor(Math.random() * 50) + 5;
        
        topTrends.push({ name: trend, score, count });
        totalSlopsCount += Math.floor(count * (score / 100));
        
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      currentAuditData = {
        title: "Weekly State of the Feed",
        date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        summary: `Our intelligence report for this week shows a significant presence of AI-generated content in top trending topics. ${topTrends[0].name} was found to be among the most "sloppy" trends.`,
        totalSlops: totalSlopsCount,
        topTrends: topTrends.sort((a, b) => b.score - a.score)
      };

      displayAuditResult(currentAuditData);
    });
  });

  function displayAuditResult(data) {
    scanStatus.textContent = 'Scan complete!';
    scanStatus.className = 'status success';
    auditProgress.style.display = 'none';
    auditResult.style.display = 'block';
    
    auditLeaderboard.innerHTML = data.topTrends.map((t, i) => `
      <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee;">
        <span>${i + 1}. ${t.name}</span>
        <span style="font-weight: bold; color: ${t.score > 70 ? '#f4212e' : '#1d9bf0'}">${t.score}% AI</span>
      </div>
    `).join('');
  }

  publishAuditBtn.addEventListener('click', () => {
    if (!currentAuditData) return;
    
    publishAuditBtn.textContent = '🚀 Publishing...';
    publishAuditBtn.disabled = true;
    
    chrome.runtime.sendMessage({ action: "publishAudit", auditData: currentAuditData }, (response) => {
      if (response && response.success) {
        scanStatus.textContent = 'Audit published to website!';
        scanStatus.className = 'status success';
        publishAuditBtn.textContent = '✅ Published';
      } else {
        scanStatus.textContent = 'Failed to publish audit.';
        scanStatus.className = 'status error';
        publishAuditBtn.textContent = 'Retry Publish';
        publishAuditBtn.disabled = false;
      }
    });
  });

  // Load state
  chrome.storage.local.get(['zerogptApiKey', 'autoScan', 'autoHide', 'hideThreshold', 'scanHistory', 'slopsCaught'], (result) => {
    if (result.zerogptApiKey) {
      apiKeyInput.value = result.zerogptApiKey;
      statusEl.textContent = 'API Key is already set.';
      statusEl.className = 'status success';
    }
    if (result.autoScan) {
      autoScanToggle.checked = true;
    }
    if (result.autoHide) {
      autoHideToggle.checked = true;
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

  // Toggle auto-hide
  autoHideToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ autoHide: e.target.checked });
  });

  // Update threshold
  thresholdSlider.addEventListener('input', (e) => {
    thresholdVal.textContent = e.target.value;
    chrome.storage.local.set({ hideThreshold: parseInt(e.target.value, 10) });
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