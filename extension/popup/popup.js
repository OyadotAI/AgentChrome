/**
 * AgentChrome popup — configure and manage browser connection.
 */

const serverUrlInput = document.getElementById('server-url');
const apiKeyInput = document.getElementById('api-key');
const browserNameInput = document.getElementById('browser-name');
const btnConnect = document.getElementById('btn-connect');
const btnDisconnect = document.getElementById('btn-disconnect');
const statusDot = document.getElementById('status-dot');
const infoPanel = document.getElementById('info');
const infoBrowserId = document.getElementById('info-browser-id');
const infoStatus = document.getElementById('info-status');

// Load saved settings
chrome.storage.local.get(['ac_server_url', 'ac_api_key', 'ac_browser_name'], (result) => {
  if (result.ac_server_url) serverUrlInput.value = result.ac_server_url;
  if (result.ac_api_key) apiKeyInput.value = result.ac_api_key;
  if (result.ac_browser_name) browserNameInput.value = result.ac_browser_name;
});

// Save settings on change
function saveSettings() {
  chrome.storage.local.set({
    ac_server_url: serverUrlInput.value.trim(),
    ac_api_key: apiKeyInput.value.trim(),
    ac_browser_name: browserNameInput.value.trim(),
  });
}

serverUrlInput.addEventListener('change', saveSettings);
apiKeyInput.addEventListener('change', saveSettings);
browserNameInput.addEventListener('change', saveSettings);

// Connect
btnConnect.addEventListener('click', () => {
  saveSettings();
  btnConnect.disabled = true;
  btnConnect.textContent = 'Connecting...';

  chrome.runtime.sendMessage({ source: 'ac-popup', type: 'connect' }, () => {
    void chrome.runtime.lastError;
    // Status update will come via ws_status message
    setTimeout(() => {
      btnConnect.disabled = false;
      btnConnect.textContent = 'Connect';
    }, 3000);
  });
});

// Disconnect
btnDisconnect.addEventListener('click', () => {
  chrome.runtime.sendMessage({ source: 'ac-popup', type: 'disconnect' }, () => {
    void chrome.runtime.lastError;
  });
});

// Get current status
chrome.runtime.sendMessage({ source: 'ac-popup', type: 'get_status' }, (response) => {
  void chrome.runtime.lastError;
  if (!response) return;
  updateUI(response.connected, response.browser_id, response.browser_name);
});

// Listen for status updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source !== 'ac-bg') return;

  if (msg.type === 'ws_status') {
    const connected = msg.status === 'connected';
    updateUI(connected, msg.browser_id, msg.browser_name);
  }
});

function updateUI(connected, browserId, browserName) {
  if (connected) {
    statusDot.className = 'status connected';
    btnConnect.style.display = 'none';
    btnDisconnect.style.display = 'block';
    infoPanel.style.display = 'block';
    infoBrowserId.textContent = browserId || '—';
    infoStatus.textContent = 'Connected';
    infoStatus.style.color = '#22c55e';
  } else {
    statusDot.className = 'status';
    btnConnect.style.display = 'block';
    btnConnect.disabled = false;
    btnConnect.textContent = 'Connect';
    btnDisconnect.style.display = 'none';
    infoPanel.style.display = 'none';
    infoStatus.textContent = 'Disconnected';
    infoStatus.style.color = '#ef4444';
  }
}
