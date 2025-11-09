import { Redis } from '@upstash/redis';
import { streamPatient, streamDoctor, memoryXRange, fileXRange } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stream events from a Redis Stream via SSE
export async function GET(request: Request) {
  const url = new URL(request.url);
  const providedStream = url.searchParams.get('stream');
  const kind = url.searchParams.get('kind');
  const id = url.searchParams.get('id');
  const streamKey = providedStream || (kind === 'patient' && id ? streamPatient(id) : (kind === 'doctor' && id ? streamDoctor(id) : null));
  const lastIdParam = url.searchParams.get('lastId');

  if (!streamKey) {
    return new Response('Missing "stream" query parameter', { status: 400 });
  }

  let redis: Redis | null = null;
  try {
    redis = Redis.fromEnv();
  } catch (err) {
    console.error('[SSE] Redis init failed', err);
    // Fallback to in-memory bus in local/dev
    redis = null;
  }

  const encoder = new TextEncoder();
  const initialId = lastIdParam || '0-0';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastId = initialId;
      let heartbeatTimer: any;

      const send = (line: string) => controller.enqueue(encoder.encode(line));
      const sendEvent = (event: Record<string, unknown>) => {
        send(`event: message\n`);
        send(`data: ${JSON.stringify(event)}\n\n`);
      };
      const heartbeat = () => {
        send(`:keepalive ${Date.now()}\n\n`);
      };

      heartbeatTimer = setInterval(heartbeat, 25000);
      heartbeat();

      // Dev-only: allow immediate test ping to verify SSE wiring
      try {
        const isDev = process.env.NODE_ENV !== 'production';
        if (isDev && url.searchParams.get('debug') === 'ping') {
          sendEvent({ id: `${Date.now()}-0`, type: 'DEBUG_PING', payload: { ok: true } });
        }
      } catch {}

      try {
        while (true) {
          // Non-blocking poll via XRANGE using official API or memory fallback
          let ranged: Array<[string, any]> | null = null;
          if (redis) {
            try {
              ranged = await (redis as Redis).xrange(
                streamKey,
                lastId === '0-0' ? '-' : `(${lastId}`,
                '+',
                100
              );
            } catch {
              ranged = null;
            }
            // If Redis is present but XRANGE failed or returned empty, fall back to file bus first, then memory
            if (!Array.isArray(ranged) || ranged.length === 0) {
              try {
                // Prefer file store first for cross-process sharing, then memory
                const fileEntries = fileXRange(streamKey, lastId, 100);
                if (Array.isArray(fileEntries) && fileEntries.length > 0) {
                  ranged = fileEntries;
                } else {
                  ranged = memoryXRange(streamKey, lastId, 100);
                }
              } catch (err) {
                console.error('[SSE] memory xrange failed (fallback)', err);
                ranged = null;
              }
            }
          } else {
            try {
              // Prefer file store first for dev, then memory fallback
              const fileEntries = fileXRange(streamKey, lastId, 100);
              if (Array.isArray(fileEntries) && fileEntries.length > 0) {
                ranged = fileEntries;
              } else {
                ranged = memoryXRange(streamKey, lastId, 100);
              }
            } catch (err) {
              console.error('[SSE] memory xrange failed', err);
              ranged = null;
            }
          }

          if (Array.isArray(ranged) && ranged.length > 0) {
            for (const entry of ranged) {
              const id = entry[0];
              const raw = entry[1];
              // raw could be an object map or array of [field, value, ...]
              const obj: Record<string, unknown> = {};
              if (Array.isArray(raw)) {
                for (let i = 0; i < raw.length; i += 2) {
                  obj[raw[i]] = raw[i + 1];
                }
              } else if (raw && typeof raw === 'object') {
                Object.assign(obj, raw);
              }
              if (typeof obj.payload === 'string') {
                try { obj.payload = JSON.parse(obj.payload as string); } catch {}
              }
              sendEvent({ id, ...obj });
              lastId = id;
            }
          }

          // Soft delay to avoid tight loop when idle
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        console.error('[SSE] stream error', err);
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}