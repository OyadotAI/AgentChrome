import { control } from './control/service.js';
import { archiveRecording, archivedManifest, archivedFrame, removeArchive, sharedRecordings } from './control/recording-storage.js';
/**
 * Session recording.
 *
 * Frames come from CDP Page.startScreencast on a second connection to the same
 * browser — nothing is injected into the page, and the client's own wire is
 * untouched, so a client using screencast itself is unaffected.
 *
 * Recording is opt-in per session (?record=1) because storage scales with
 * fleet size: at 1k-5k sessions, recording everything by default would be the
 * largest thing this control plane writes.
 */

import { mkdir, writeFile, readFile, readdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CDPConnection } from './drivers/cdp.js';
import { metrics } from './metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.OYA_DATA_DIR
  ? join(process.env.OYA_DATA_DIR, 'recordings')
  : join(__dirname, '..', 'data', 'recordings');

const MAX_FRAMES = Number(process.env.OYA_RECORD_MAX_FRAMES) || 1800;   // ~15 min at 2fps
const MAX_BYTES = Number(process.env.OYA_RECORD_MAX_BYTES) || 100 * 1024 * 1024;
const QUALITY = Number(process.env.OYA_RECORD_QUALITY) || 40;
const EVERY_NTH = Number(process.env.OYA_RECORD_EVERY_NTH) || 5;

const active = new Map(); // sessionId -> { conn, frames, bytes, startedAt, dir }

export function isRecording(sessionId) { return active.has(sessionId); }

export async function start(session) {
  if (active.has(session.id)) return false;
  const resource = await control().store.get('session', session.attachedTo || session.id);
  const project = resource && await control().store.get('project', resource.project);
  if ([...(resource?.policies || []), project?.settings.policy || {}].some(p => p.redactRecording)) throw Object.assign(new Error('Recording is disabled by the visual-redaction policy'), { status: 422 });
  if (process.env.OYA_INSTANCE_URL && !sharedRecordings()) throw Object.assign(new Error('Distributed recording requires OYA_RECORDING_BUCKET'), { status: 422 });

  const conn = await new CDPConnection(session.upstreamUrl).connect();
  const { targetInfos = [] } = await conn.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  if (!page) { conn.close(); return false; }
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });

  const dir = join(DIR, session.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const state = {
    conn, sessionId, dir, frames: [], bytes: 0,
    startedAt: Date.now(),
    provider: session.provider, owner: session.owner, profile: session.profile,
  };
  active.set(session.id, state);

  conn.on('Page.screencastFrame', async (params) => {
    // Ack first: Chrome stops sending until the frame is acknowledged, and a
    // slow disk must not stall the recorded browser.
    conn.send('Page.screencastFrameAck', { sessionId: params.sessionId }, sessionId).catch(() => {});

    if (state.frames.length >= MAX_FRAMES || state.bytes >= MAX_BYTES) return;
    const buf = Buffer.from(params.data, 'base64');
    const index = state.frames.length;
    state.frames.push({
      i: index,
      t: Date.now() - state.startedAt,
      meta: params.metadata ? { w: params.metadata.deviceWidth, h: params.metadata.deviceHeight } : null,
      bytes: buf.length,
    });
    state.bytes += buf.length;
    metrics.recordedFrames.inc({});
    writeFile(join(dir, `${String(index).padStart(6, '0')}.jpg`), buf).catch(() => {});
  });

  await conn.send('Page.enable', {}, sessionId).catch(() => {});
  await conn.send('Page.startScreencast',
    { format: 'jpeg', quality: QUALITY, maxWidth: 1280, maxHeight: 800, everyNthFrame: EVERY_NTH }, sessionId);

  metrics.recordings.inc({ event: 'start' });
  return true;
}

export async function stop(sessionId) {
  const state = active.get(sessionId);
  if (!state) return false;
  active.delete(sessionId);
  try { await state.conn.send('Page.stopScreencast', {}, state.sessionId); } catch {}
  state.conn.close();

  const manifest = {
    sessionId,
    // A recording is a picture of someone's browser. Ownership travels with it.
    owner: state.owner,
    provider: state.provider,
    profile: state.profile || null,
    startedAt: new Date(state.startedAt).toISOString(),
    durationMs: Date.now() - state.startedAt,
    frameCount: state.frames.length,
    bytes: state.bytes,
    truncated: state.frames.length >= MAX_FRAMES || state.bytes >= MAX_BYTES,
    frames: state.frames,
  };
  await writeFile(join(state.dir, 'manifest.json'), JSON.stringify(manifest));
  await archiveRecording(manifest, state.dir).catch(e => console.error('[recording] local spool retained:', e.message));
  metrics.recordings.inc({ event: 'stop' });
  return true;
}

/** `owner` null means an operator listing everything. */
export async function list(owner) {
  try {
    const dirs = await readdir(DIR);
    const out = [];
    for (const id of dirs) {
      try {
        const m = JSON.parse(await readFile(join(DIR, id, 'manifest.json'), 'utf8'));
        if (owner && m.owner !== owner) continue;
        out.push({ ...m, frames: undefined, live: active.has(id) });
      } catch {
        const live = active.get(id);
        if (live && (!owner || live.owner === owner)) {
          out.push({ sessionId: id, owner: live.owner, live: true, frameCount: live.frames.length });
        }
      }
    }
    for (const m of await control().store.list('recording', owner ? { states: [owner] } : {})) if (!out.some(x => x.sessionId === m.sessionId)) out.push({ ...m, frames: undefined, live: false });
    return out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  } catch {
    return (await control().store.list('recording', owner ? { states: [owner] } : {})).map(m => ({ ...m, frames: undefined, live: false }));
  }
}

/** Returns null rather than 403 for someone else's recording: its existence is not their business. */
export async function manifest(sessionId, owner) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const live = active.get(sessionId);
  if (live) {
    if (owner && live.owner !== owner) return null;
    return {
      sessionId, owner: live.owner, live: true, frameCount: live.frames.length, bytes: live.bytes,
      durationMs: Date.now() - live.startedAt, frames: live.frames,
    };
  }
  try {
    const m = JSON.parse(await readFile(join(DIR, sessionId, 'manifest.json'), 'utf8'));
    if (owner && m.owner !== owner) return null;
    return m;
  } catch { return archivedManifest(sessionId, owner); }
}

export async function frame(sessionId, index, owner) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > MAX_FRAMES) return null;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  // A frame is a screenshot of a browser, so the same check as the manifest.
  if (!(await manifest(sessionId, owner))) return null;
  try { return await readFile(join(DIR, sessionId, `${String(i).padStart(6, '0')}.jpg`)); }
  catch { return archivedFrame(sessionId, i, owner); }
}

export async function remove(sessionId, owner) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return false;
  if (!(await manifest(sessionId, owner))) return false;
  if (active.has(sessionId)) await stop(sessionId);
  await removeArchive(sessionId, owner);
  try { await rm(join(DIR, sessionId), { recursive: true, force: true }); return true; }
  catch { return false; }
}

/** Retention and failed-upload retry run independently of browser command traffic. */
export async function maintain() {
  const [projects, archived] = await control().store.load([{ kind: 'project' }, { kind: 'recording' }]);
  const days = new Map(projects.map(({ body: p }) => [p.legacyOwner, p.settings.recordingDays]));
  const stored = new Set(archived.map(r => r.id));
  for (const entry of await list(null)) {
    if (entry.live) continue;
    if (Date.parse(entry.startedAt) < Date.now() - (days.get(entry.owner) || 7) * 86400000) {
      await remove(entry.sessionId, entry.owner);
    } else if (sharedRecordings() && !stored.has(entry.sessionId)) {
      const m = await manifest(entry.sessionId, entry.owner);
      if (m) await archiveRecording(m, join(DIR, entry.sessionId));
    }
  }
}
