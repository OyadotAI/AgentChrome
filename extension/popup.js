/**
 * Oya Browser Extension — Popup
 * Shows MCP config, connection status, and settings.
 */

const $ = (id) => document.getElementById(id);
let currentPort = 9333;

// ─── Status ───

function updateStatus(connected) {
  const bar = $('status-bar');
  const text = $('status-text');
  const tag = $('brand-tag');

  if (connected) {
    bar.className = 'status-bar ok';
    text.textContent = 'Connected — AI agents can control this browser';
    tag.className = 'brand-tag on';
    tag.textContent = 'live';
  } else {
    bar.className = 'status-bar wait';
    text.textContent = 'Waiting for bridge on port ' + currentPort + '...';
    tag.className = 'brand-tag off';
    tag.textContent = 'offline';
  }
}

function updateUrls() {
  const url = `http://localhost:${currentPort}/mcp`;
  $('mcp-url-cursor').textContent = url;
  $('mcp-url-cc').textContent = url;
  $('mcp-url-desktop').textContent = url;
}

// ─── Init ───

try {
  chrome.runtime.sendMessage({ type: 'get-status' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res) {
      currentPort = res.port || 9333;
      $('port-input').value = currentPort;
      updateStatus(res.connected);
      updateUrls();
    }
  });
} catch {}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') {
    updateStatus(msg.connected);
  }
});

// ─── Tabs ───

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ─── Copy Config ───

document.querySelectorAll('.config-block').forEach(block => {
  block.addEventListener('click', () => {
    // Get plain text (strip HTML tags)
    const text = block.textContent.replace('click to copy', '').trim();
    navigator.clipboard.writeText(text).then(() => {
      block.classList.add('copied');
      block.querySelector('.copy-badge').textContent = 'copied!';
      setTimeout(() => {
        block.classList.remove('copied');
        block.querySelector('.copy-badge').textContent = 'click to copy';
      }, 2000);
    });
  });
});

// ─── Port ───

let portTimer = null;
$('port-input').addEventListener('input', () => {
  clearTimeout(portTimer);
  portTimer = setTimeout(() => {
    const val = parseInt($('port-input').value, 10);
    if (val >= 1024 && val <= 65535) {
      currentPort = val;
      updateUrls();
      chrome.runtime.sendMessage({ type: 'set-port', port: val }, () => { if (chrome.runtime.lastError) {} });
    }
  }, 500);
});

// ─── Side Panel Toggle ───

chrome.storage.local.get(['oya_side_panel'], (data) => {
  if (data.oya_side_panel) $('panel-switch').classList.add('on');
});

$('panel-toggle').addEventListener('click', async () => {
  const sw = $('panel-switch');
  const isOn = sw.classList.toggle('on');
  await chrome.storage.local.set({ oya_side_panel: isOn });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = tab?.windowId;

  if (isOn) {
    // Enable and open
    await chrome.sidePanel.setOptions({ enabled: true }).catch(() => {});
    if (windowId) chrome.sidePanel.open({ windowId }).catch(() => {});
  } else {
    // Disable to force close, then re-enable so it can be toggled on later
    await chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
    await chrome.sidePanel.setOptions({ enabled: true }).catch(() => {});
  }
});
