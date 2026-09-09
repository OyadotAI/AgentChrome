/**
 * Outbound destination guard.
 *
 * The control plane dials URLs that callers supply — CDP providers, model
 * endpoints. Its network position is not the caller's, so an unchecked URL is
 * a server-side request forgery primitive: cloud metadata, a loopback admin
 * port, anything routable from the host.
 *
 * Loopback and private ranges are refused unless the host opts in with
 * OYA_ALLOW_PRIVATE_TARGETS=true. That opt-in exists because a single-operator
 * self-hosted install legitimately points at ws://127.0.0.1:9222; it should
 * never be on for a deployment where keys belong to other people.
 */

import { lookup } from 'dns/promises';
import { isIP } from 'net';

const allowPrivate = () => process.env.OYA_ALLOW_PRIVATE_TARGETS === 'true';

/**
 * Never routable on a caller's behalf, opt-in or not. Link-local carries the
 * cloud metadata service (169.254.169.254) and has no legitimate use as a
 * browser endpoint, so the self-hosting escape hatch must not cover it.
 */
export function isNeverAllowed(ip) {
  const v = isIP(ip);
  if (!v) return true;
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isNeverAllowed(mapped[1]);
    return /^fe[89ab]/.test(s) || s === '::';
  }
  const [a, b] = ip.split('.').map(Number);
  return (a === 169 && b === 254) || a === 0 || a >= 224;
}

/** True for addresses that are not safely routable on behalf of a caller. */
export function isPrivateAddress(ip) {
  const v = isIP(ip);
  if (!v) return true;                       // unresolvable is not safe

  if (v === 6) {
    const s = ip.toLowerCase();
    // IPv4-mapped (::ffff:127.0.0.1) must be judged as the v4 address.
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (s === '::1' || s === '::') return true;
    if (/^f[cd]/.test(s)) return true;       // unique local fc00::/7
    if (/^fe[89ab]/.test(s)) return true;    // link-local fe80::/10
    return false;
  }

  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 127 ||                  // this host, loopback
    a === 10 ||                              // RFC1918
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||              // link-local, incl. cloud metadata
    (a === 100 && b >= 64 && b <= 127) ||    // CGNAT
    (a === 192 && b === 0) ||                // protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224                                 // multicast, reserved
  );
}

/**
 * Validate a caller-supplied URL and resolve it, so a public hostname pointing
 * at an internal address is caught too.
 *
 * ponytail: resolves here, connects later — a name could change in between
 * (DNS rebinding). Closing that needs the socket pinned to the address checked,
 * which means a custom agent/lookup on every dial site. Re-validated at connect
 * time as well, which narrows the window to the dial itself.
 *
 * @returns {Promise<{ href: string, hostname: string, addresses: string[] }>}
 */
export async function assertSafeTarget(raw, { protocols = ['ws:', 'wss:'], label = 'URL' } = {}) {
  const fail = (why) => { throw Object.assign(new Error(`${label} ${why}`), { status: 400 }); };

  let url;
  try { url = new URL(String(raw)); } catch { return fail('is not a valid URL'); }
  if (!protocols.includes(url.protocol)) fail(`must use ${protocols.join(' or ')}`);
  if (url.username || url.password) fail('must not embed credentials');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      return fail(`hostname could not be resolved (${host})`);
    }
  }
  if (!addresses.length) fail(`hostname could not be resolved (${host})`);

  const never = addresses.filter(isNeverAllowed);
  if (never.length) {
    fail(`resolves to a link-local or reserved address (${never[0]}), which is never dialled `
      + 'on behalf of a caller. That range carries the cloud metadata service.');
  }

  if (!allowPrivate()) {
    const blocked = addresses.filter(isPrivateAddress);
    if (blocked.length) {
      fail(`resolves to a private or loopback address (${blocked[0]}). `
        + 'Set OYA_ALLOW_PRIVATE_TARGETS=true only on a single-operator host where every '
        + 'API key is yours.');
    }
  }

  return { href: url.href, hostname: host, addresses };
}
