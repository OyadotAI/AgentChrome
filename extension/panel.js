/**
 * Oya Browser Extension — Side Panel
 * Quick actions and page source view.
 */

const $ = (id) => document.getElementById(id);

// ─── Status ───

function updateStatus(connected) {
  const el = $('panel-status');
  el.className = 'header-status ' + (connected ? 'on' : 'off');
  el.textContent = connected ? 'live' : 'offline';
}

try {
  chrome.runtime.sendMessage({ type: 'get-status' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res) updateStatus(res.connected);
  });
} catch {}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') updateStatus(msg.connected);
});

// ─── Tabs ───

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`panel-${tab.dataset.panel}`).classList.add('active');
  });
});

// ─── Run command on active tab's content script ───

async function runCommand(action, params) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { ok: false, error: 'No active tab' };

  // Ensure content script is loaded
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch {}

  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'cmd', action, params });
    return result || { ok: false, error: 'No response' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function showResult(result) {
  const el = $('action-result');
  if (result.ok) {
    const text = result.data?.markdown
      ? `OK — ${result.data.elements?.length || 0} elements found`
      : JSON.stringify(result.data || {}, null, 2);
    el.innerHTML = `<span class="result-ok">OK</span> ${escapeHtml(text).slice(0, 500)}`;
  } else {
    el.innerHTML = `<span class="result-err">Error:</span> ${escapeHtml(result.error || 'Unknown')}`;
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Actions ───

$('btn-analyze').addEventListener('click', async () => {
  $('action-result').textContent = 'Analyzing...';
  const result = await runCommand('analyze_page', {});
  showResult(result);
  if (result.ok && result.data?.markdown) {
    $('source-content').textContent = result.data.markdown;
  }
});

$('btn-screenshot').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    $('action-result').innerHTML = `<span class="result-ok">Screenshot captured</span><br><img src="${dataUrl}" style="max-width:100%;margin-top:8px;border-radius:4px;">`;
  } catch (err) {
    $('action-result').innerHTML = `<span class="result-err">Error:</span> ${escapeHtml(err.message)}`;
  }
});

$('btn-scroll-down').addEventListener('click', async () => {
  const result = await runCommand('scroll', { direction: 'down', amount: 500 });
  showResult(result);
});

$('btn-scroll-up').addEventListener('click', async () => {
  const result = await runCommand('scroll', { direction: 'up', amount: 500 });
  showResult(result);
});

$('btn-navigate').addEventListener('click', async () => {
  const url = $('nav-url').value.trim();
  if (!url) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await chrome.tabs.update(tab.id, { url: /^https?:\/\//i.test(url) ? url : 'https://' + url });
    $('action-result').innerHTML = `<span class="result-ok">Navigating to ${escapeHtml(url)}</span>`;
  }
});

$('nav-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-navigate').click();
});

$('btn-click').addEventListener('click', async () => {
  const id = parseInt($('element-id').value, 10);
  if (!id) return;
  const result = await runCommand('click', { element_id: id });
  showResult(result);
});

$('btn-hover').addEventListener('click', async () => {
  const id = parseInt($('element-id').value, 10);
  if (!id) return;
  const result = await runCommand('hover', { element_id: id });
  showResult(result);
});

$('btn-type').addEventListener('click', async () => {
  const id = parseInt($('type-element-id').value, 10);
  const text = $('type-text').value;
  if (!id || !text) return;
  const result = await runCommand('type', { element_id: id, text });
  showResult(result);
});

// Key press buttons
document.querySelectorAll('[data-key]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const result = await runCommand('press_key', { key: btn.dataset.key });
    showResult(result);
  });
});
