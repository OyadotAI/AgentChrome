import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * Where the CLI remembers your key. One file, mode 600 — this is a credential,
 * and it is the identity for everything the control plane does on your behalf.
 */
const FILE = join(process.env.OYA_CONFIG_HOME || join(homedir(), '.oya'), 'config.json');

export interface CliConfig {
  apiKey?: string;
  baseUrl?: string;
}

export function load(): CliConfig {
  try { return JSON.parse(readFileSync(FILE, 'utf8')) as CliConfig; }
  catch { return {}; }
}

export function save(values: CliConfig): void {
  const merged = { ...load(), ...values };
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);   // an existing file keeps its old mode without this
}

export const configPath = FILE;

/** Flags and environment beat the saved file, so CI never needs `oya login`. */
export function resolved(): Required<CliConfig> {
  const saved = load();
  return {
    apiKey: process.env.OYA_API_KEY || saved.apiKey || '',
    baseUrl: (process.env.OYA_BASE_URL || saved.baseUrl || 'https://browser.getoya.ai').replace(/\/+$/, ''),
  };
}
