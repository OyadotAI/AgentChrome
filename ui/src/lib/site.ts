/**
 * One place for the canonical origin.
 *
 * Metadata, sitemap, robots and JSON-LD all have to agree on it — a mismatch
 * between them is how a site ends up with two identities in an index. The env
 * var lets a self-hosted deployment point them all at its own domain.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://browser.getoya.ai').replace(/\/$/, '');

export const SITE_NAME = 'Oya Browser';

export const SITE_TAGLINE = 'The Browser Control Plane for AI Agents';

export const SITE_DESCRIPTION =
  'One API drives real Chrome across Oya Cloud, Browserbase, Steel, Anchor, Browser Use and private machines. '
  + 'Deterministic personas keep a logged-in identity stable, live view lets a human take over mid-run, '
  + 'and provider failover needs no rewrite.';
