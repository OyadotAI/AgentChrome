/**
 * Offscreen keepalive — prevents Chrome from suspending the service worker
 * by maintaining an active offscreen document that periodically pings it.
 */

setInterval(() => {
  chrome.runtime.sendMessage({ source: 'ac-keepalive', type: 'keepalive' }, () => {
    void chrome.runtime.lastError;
  });
}, 20000);
