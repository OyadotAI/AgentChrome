/** Managed-only browser hooks. Network isolation remains the outer enforcement boundary. */
const configuration = process.env.OYA_GOVERNANCE ? JSON.parse(process.env.OYA_GOVERNANCE) : null;
let mode = 'agent';
function matches(host, rules) {
  host = host.toLowerCase().replace(/\.$/, '');
  return rules.some(rule => rule.startsWith('*.') ? host.endsWith(rule.slice(1)) && host !== rule.slice(2) : host === rule);
}
function allowed(raw) {
  if (!configuration) return true;
  if (raw === 'about:blank') return true;
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return false;
  return configuration.policies.every(policy =>
    (!policy.allowedHosts || matches(url.hostname, policy.allowedHosts)) &&
    (!policy.humanHosts || !matches(url.hostname, policy.humanHosts) || mode === 'human'));
}
function install(session) {
  if (!configuration) return;
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed(details.url) }));
  session.setPermissionRequestHandler((contents, permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}
module.exports = { configuration, install, allowed, setMode(value) { mode = value === 'human' ? 'human' : 'agent'; } };
