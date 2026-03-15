/**
 * Agent script for Electron — same DOM primitives as extension version,
 * exposed as window functions instead of chrome.runtime message handlers.
 */

(function () {
  'use strict';
  if (window.__acAgentLoaded) return;
  window.__acAgentLoaded = true;
})();
