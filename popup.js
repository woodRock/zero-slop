document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  const toggles = {
    communityShield: $('communityShieldToggle'),
    hunterVision: $('hunterVisionToggle'),
    autoHumanDetection: $('autoHumanDetectionToggle'),
    profileAlerts: $('profileAlertsToggle'),
    autoScan: $('autoScanToggle'),
    adminOrganicCollection: $('adminOrganicToggle')
  };
  // Settings that are on unless the user turned them off.
  const DEFAULT_ON = ['communityShield', 'profileAlerts'];

  const ACTION_HINTS = {
    none: 'Flagged posts get a label but stay fully visible.',
    blur: 'Flagged text is blurred. Click it to reveal.',
    zap: 'Flagged posts collapse to a one-line note you can expand.'
  };

  const apiKeyInput = $('apiKey');
  const keyStatus = $('keyStatus');
  const thresholdSlider = $('thresholdSlider');
  const thresholdVal = $('thresholdVal');
  const historyList = $('historyList');
  const exportBtn = $('exportBtn');
  const clearBtn = $('clearHistoryBtn');

  $('version').textContent = `v${chrome.runtime.getManifest().version}`;

  // ---- Tabs (arrow keys move between them, per the ARIA tabs pattern) ----
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  function selectTab(tab) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !selected;
    });
    tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        selectTab(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]);
      }
    });
  });

  // ---- Load state ----
  chrome.storage.local.get(
    [...Object.keys(toggles), 'zerogptApiKey', 'slopAction', 'hideThreshold', 'scanHistory', 'slopsCaught'],
    (result) => {
      for (const [key, input] of Object.entries(toggles)) {
        input.checked = DEFAULT_ON.includes(key) ? result[key] !== false : !!result[key];
      }
      apiKeyInput.value = result.zerogptApiKey || '';
      setKeyState(!!result.zerogptApiKey);

      const action = result.slopAction || 'blur';
      const radio = document.querySelector(`input[name="slopAction"][value="${action}"]`);
      if (radio) radio.checked = true;
      updateActionUi(action);

      const threshold = result.hideThreshold ?? 85;
      thresholdSlider.value = threshold;
      thresholdVal.textContent = `${threshold}%`;

      $('slopsCaughtCount').textContent = (result.slopsCaught || 0).toLocaleString();
      renderHistory(result.scanHistory || []);
      updateStatus();
    }
  );

  // ---- Toggles ----
  for (const [key, input] of Object.entries(toggles)) {
    input.addEventListener('change', () => {
      chrome.storage.local.set({ [key]: input.checked });
      updateStatus();
    });
  }

  function updateStatus() {
    const on = toggles.communityShield.checked || toggles.hunterVision.checked ||
      toggles.autoHumanDetection.checked || toggles.autoScan.checked;
    $('status').classList.toggle('off', !on);
    $('statusText').textContent = on ? 'Protecting your timeline' : 'All detection is off';
  }

  // ---- Slop action and threshold ----
  document.querySelectorAll('input[name="slopAction"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      chrome.storage.local.set({ slopAction: radio.value });
      updateActionUi(radio.value);
    });
  });

  function updateActionUi(action) {
    $('actionHint').textContent = ACTION_HINTS[action] || '';
    $('thresholdRow').hidden = action === 'none';
  }

  thresholdSlider.addEventListener('input', () => {
    thresholdVal.textContent = `${thresholdSlider.value}%`;
  });
  thresholdSlider.addEventListener('change', () => {
    chrome.storage.local.set({ hideThreshold: parseInt(thresholdSlider.value, 10) });
  });

  // ---- API key ----
  function setKeyState(hasKey) {
    $('keyBadge').textContent = hasKey ? 'Ready' : 'Not set up';
    toggles.autoScan.disabled = !hasKey;
    $('autoScanRow').classList.toggle('disabled', !hasKey);
    $('autoScanRow').title = hasKey ? '' : 'Save an API key to turn this on';
  }

  function showKeyStatus(text, kind) {
    keyStatus.textContent = text;
    keyStatus.className = `field-status ${kind || ''}`;
  }

  $('toggleKey').addEventListener('click', (e) => {
    const show = apiKeyInput.type === 'password';
    apiKeyInput.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-pressed', String(show));
    e.currentTarget.setAttribute('aria-label', show ? 'Hide API key' : 'Show API key');
  });

  function saveKey() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      chrome.storage.local.remove('zerogptApiKey', () => {
        if (toggles.autoScan.checked) {
          toggles.autoScan.checked = false;
          chrome.storage.local.set({ autoScan: false });
        }
        setKeyState(false);
        showKeyStatus('Key removed. Deep scans are off.', '');
        updateStatus();
      });
      return;
    }
    chrome.storage.local.set({ zerogptApiKey: apiKey }, () => {
      setKeyState(true);
      showKeyStatus('Saved. Right-click any post to run a deep scan.', 'ok');
    });
  }
  $('saveBtn').addEventListener('click', saveKey);
  apiKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveKey(); });
  apiKeyInput.addEventListener('input', () => showKeyStatus('', ''));

  // ---- History ----
  function tone(pct) {
    if (pct >= 70) return 'red';
    if (pct > 15) return 'amber';
    return 'green';
  }

  function timeAgo(iso) {
    const then = new Date(iso).getTime();
    if (!then) return '';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function renderHistory(history) {
    historyList.replaceChildren();
    const empty = history.length === 0;
    exportBtn.disabled = empty;
    clearBtn.disabled = empty;

    if (empty) {
      const li = document.createElement('li');
      li.className = 'empty';
      const title = document.createElement('strong');
      title.textContent = 'No scans yet';
      li.append(title, 'Right-click a post on X and choose ZeroSlop → Check with ZeroGPT. Results will show up here.');
      historyList.appendChild(li);
      return;
    }

    history.slice().reverse().forEach((item) => {
      const pct = Math.round(Number(item.percentage) || 0);
      const li = document.createElement('li');

      const score = document.createElement('span');
      score.className = `score ${tone(pct)}`;
      score.textContent = `${pct}%`;
      score.title = `${pct}% AI`;

      const body = document.createElement('div');
      body.style.flex = '1';
      body.style.minWidth = '0';
      const text = document.createElement('div');
      text.className = 'text';
      text.textContent = item.text;
      text.title = item.text;
      const when = document.createElement('div');
      when.className = 'when';
      when.textContent = [timeAgo(item.timestamp), item.words ? `${item.words} words` : ''].filter(Boolean).join(' · ');
      body.append(text, when);

      li.append(score, body);
      historyList.appendChild(li);
    });
  }

  // Two-step clear: the first click asks for confirmation instead of a blocking dialog.
  let confirmTimer = null;
  clearBtn.addEventListener('click', () => {
    if (!clearBtn.classList.contains('confirming')) {
      clearBtn.classList.add('confirming');
      clearBtn.textContent = 'Click again to clear';
      confirmTimer = setTimeout(resetClear, 3000);
      return;
    }
    resetClear();
    chrome.storage.local.set({ scanHistory: [] }, () => renderHistory([]));
  });
  function resetClear() {
    clearTimeout(confirmTimer);
    clearBtn.classList.remove('confirming');
    clearBtn.textContent = 'Clear history';
  }

  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(['scanHistory'], (result) => {
      const history = result.scanHistory || [];
      if (history.length === 0) return;
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['Timestamp', 'Text', 'AI Percentage', 'Words'].join(',')];
      history.forEach((item) => rows.push([esc(item.timestamp), esc(item.text), item.percentage, item.words].join(',')));
      const url = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `zeroslop-history-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
});
