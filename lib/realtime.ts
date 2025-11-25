import { Redis } from '@upstash/redis';
import fs from 'fs';
import path from 'path';

let redis: Redis | null = null;
try {
  // Create a Redis client from environment variables
  redis = Redis.fromEnv();
} catch {
  // In local/dev without env, gracefully disable realtime and enable memory bus
  redis = null;
}

const isProd =
  process.env.NODE_ENV === 'production' ||
  process.env.VERCEL === '1' ||
  process.env.VERCEL_ENV === 'production';

// In-memory realtime bus for local/dev when Redis is unavailable.
type MemoryEntry = [string, Record<string, string>];
type MemoryStream = { entries: MemoryEntry[]; lastSeq: number };

function getMemoryBus(): Map<string, MemoryStream> {
  const g = globalThis as unknown as { __RT_MEM_BUS?: Map<string, MemoryStream> };
  if (!g.__RT_MEM_BUS) {
    g.__RT_MEM_BUS = new Map<string, MemoryStream>();
  }
  return g.__RT_MEM_BUS as Map<string, MemoryStream>;
}

function memXAdd(streamKey: string, fields: Record<string, string>) {
  const bus = getMemoryBus();
  let stream = bus.get(streamKey);
  if (!stream) {
    stream = { entries: [], lastSeq: 0 };
    bus.set(streamKey, stream);
  }
  stream.lastSeq += 1;
  const id = `${Date.now()}-${stream.lastSeq}`;
  stream.entries.push([id, fields]);
  // Retain at most 1000 entries to avoid unbounded growth
  if (stream.entries.length > 1000) stream.entries.shift();
}

// --- File-based store for dev to share events across route processes ---
const STORE_DIR = process.env.REALTIME_STORE_DIR || path.join(process.cwd(), '.realtime-store');

function ensureStoreDir() {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  } catch {}
}

function streamFilePath(streamKey: string): string {
  // Sanitize key to be safe as filename
  const safe = encodeURIComponent(streamKey);
  return path.join(STORE_DIR, `${safe}.json`);
}

function readStreamFile(streamKey: string): MemoryEntry[] {
  ensureStoreDir();
  const file = streamFilePath(streamKey);
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as MemoryEntry[];
  } catch {}
  return [];
}

function writeStreamFile(streamKey: string, entries: MemoryEntry[]) {
  ensureStoreDir();
  const file = streamFilePath(streamKey);
  try {
    fs.writeFileSync(file, JSON.stringify(entries), 'utf-8');
  } catch (err) {
    console.error('[Realtime] writeStreamFile failed', { streamKey, err });
  }
}

function fileXAdd(streamKey: string, fields: Record<string, string>) {
  try {
    const entries = readStreamFile(streamKey);
    const last = entries.length > 0 ? entries[entries.length - 1][0] : '0-0';
    const lastSeq = Number((last.split('-')[1] || '0')) || 0;
    const id = `${Date.now()}-${lastSeq + 1}`;
    entries.push([id, fields]);
    if (entries.length > 1000) entries.shift();
    writeStreamFile(streamKey, entries);
  } catch (err) {
    console.error('[Realtime] File XADD failed', { streamKey, err });
  }
}

function compareStreamId(a: string, b: string): number {
  if (!b || b === '0-0') return 1;
  const [amsStr, aseqStr] = a.split('-');
  const [bmsStr, bseqStr] = b.split('-');
  const ams = Number(amsStr) || 0;
  const aseq = Number(aseqStr) || 0;
  const bms = Number(bmsStr) || 0;
  const bseq = Number(bseqStr) || 0;
  if (ams !== bms) return ams - bms;
  return aseq - bseq;
}

export function memoryXRange(
  streamKey: string,
  startIdExclusive: string,
  count = 100
): MemoryEntry[] {
  const bus = getMemoryBus();
  const s = bus.get(streamKey);
  if (!s) return [];
  const res: MemoryEntry[] = [];
  for (const e of s.entries) {
    const id = e[0];
    if (compareStreamId(id, startIdExclusive) > 0) {
      res.push(e);
      if (res.length >= count) break;
    }
  }
  return res;
}

export function fileXRange(
  streamKey: string,
  startIdExclusive: string,
  count = 100
): MemoryEntry[] {
  const entries = readStreamFile(streamKey);
  const res: MemoryEntry[] = [];
  for (const e of entries) {
    const id = e[0];
    if (compareStreamId(id, startIdExclusive) > 0) {
      res.push(e);
      if (res.length >= count) break;
    }
  }
  return res;
}

export function hasRealtime(): boolean {
  // Consider memory bus as realtime capability in local/dev
  return !!redis || getMemoryBus().size >= 0;
}

function envPrefix(): string {
  return (
    process.env.UPSTASH_CHANNEL_PREFIX ||
    process.env.VERCEL_ENV ||
    (process.env.NODE_ENV === 'production' ? 'production' : 'dev')
  );
}

export function streamPatient(patientId: string): string {
  return `stream:${envPrefix()}:patient:${patientId}`;
}

export function streamDoctor(doctorId: string): string {
  return `stream:${envPrefix()}:doctor:${doctorId}`;
}

async function xadd(streamKey: string, fields: Record<string, string>) {
  const typeVal = fields?.type || 'UNKNOWN';
  const tsVal = fields?.ts || String(Date.now());
  if (!redis) {
    if (!isProd) {
      try { memXAdd(streamKey, fields); } catch (err) { console.error('[Realtime] Memory XADD failed', { streamKey, type: typeVal, ts: tsVal, err }); }
      try { fileXAdd(streamKey, fields); } catch (err) { console.error('[Realtime] File XADD failed', { streamKey, type: typeVal, ts: tsVal, err }); }
      try { console.warn('[Realtime] Fallback write store=file+memory', { streamKey, type: typeVal, ts: tsVal }); } catch {}
    } else {
      try { console.warn('[Realtime] Realtime disabled in production without Redis'); } catch {}
    }
    return;
  }
  try {
    await (redis as Redis).xadd(streamKey, '*', fields);
    try { console.log('[Realtime] Upstash XADD ok', { streamKey, type: typeVal, ts: tsVal }); } catch {}
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    try { console.error('[Realtime] Upstash XADD failed', { streamKey, type: typeVal, ts: tsVal, err: msg }); } catch {}
    if (msg && (msg.toLowerCase().includes('max requests') || msg.includes('429'))) {
      try { console.warn('[Realtime] Upstash request limit exceeded. Consider upgrading plan or reducing polling.'); } catch {}
    }
    if (!isProd) {
      try { memXAdd(streamKey, fields); } catch (memErr) { console.error('[Realtime] Memory XADD fallback failed', { streamKey, type: typeVal, ts: tsVal, err: memErr }); }
      try { fileXAdd(streamKey, fields); } catch (fileErr) { console.error('[Realtime] File XADD fallback failed', { streamKey, type: typeVal, ts: tsVal, err: fileErr }); }
      try { console.warn('[Realtime] Fallback write store=file+memory', { streamKey, type: typeVal, ts: tsVal }); } catch {}
    }
  }
}

export async function publishDoctorEvent(
  doctorId: string,
  type: string,
  payload: unknown
): Promise<void> {
  const key = streamDoctor(doctorId);
  await xadd(key, {
    type,
    payload: JSON.stringify(payload ?? {}),
    ts: String(Date.now()),
  });
}

export async function publishPatientEvent(
  patientId: string,
  type: string,
  payload: unknown
): Promise<void> {
  const allowedPatientTypes = new Set([
    'APPOINTMENT_CREATED',
    'APPOINTMENT_CANCELLED',
    'APPOINTMENT_STATUS_UPDATED',
    'APPOINTMENT_RESCHEDULED',
  ]);
  if (!allowedPatientTypes.has(type)) {
    return;
  }
  const key = streamPatient(patientId);
  await xadd(key, {
    type,
    payload: JSON.stringify(payload ?? {}),
    ts: String(Date.now()),
  });
}

// Debug-only memory publish helpers for local validation
export async function memoryPublishDoctorEvent(
  doctorId: string,
  type: string,
  payload: unknown
): Promise<void> {
  const key = streamDoctor(doctorId);
  memXAdd(key, {
    type,
    payload: JSON.stringify(payload ?? {}),
    ts: String(Date.now()),
  });
}

export async function memoryPublishPatientEvent(
  patientId: string,
  type: string,
  payload: unknown
): Promise<void> {
  const key = streamPatient(patientId);
  memXAdd(key, {
    type,
    payload: JSON.stringify(payload ?? {}),
    ts: String(Date.now()),
  });
}

// Debug-only file publish helpers for local validation across processes
export async function filePublishDoctorEvent(
  doctorId: string,
  type: string,
  payload: unknown
): Promise<void> {
  const key = streamDoctor(doctorId);
  fileXAdd(key, {
    type,
    payload: JSON.stringify(payload ?? {}),
    ts: String(Date.now()),
  });
}

export async function filePublishPatientEvent(
  patientId: string,
  type: string,
  payload: unknown
): Promise<void> {
  const key = streamPatient(patientId);
  fileXAdd(key, {
    type,
    payload: JSON.stringify(payload ?? {}),
    ts: String(Date.now()),
  });
}