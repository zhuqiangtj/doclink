import { NextRequest, NextResponse } from 'next/server';
import { streamDoctor, streamPatient, memoryXRange, fileXRange } from '@/lib/realtime';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('kind');
  const id = searchParams.get('id');
  const lastId = searchParams.get('lastId') || '0-0';
  const countStr = searchParams.get('count');
  const count = countStr ? Math.max(1, Math.min(500, Number(countStr) || 100)) : 100;
  const store = (searchParams.get('store') || '').toLowerCase();

  if (!kind || !id) {
    return NextResponse.json({ error: 'Missing kind or id' }, { status: 400 });
  }

  const streamKey = kind === 'doctor' ? streamDoctor(id) : kind === 'patient' ? streamPatient(id) : null;
  if (!streamKey) {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }

  try {
    const ranged = store === 'file' ? fileXRange(streamKey, lastId, count) : memoryXRange(streamKey, lastId, count);
    const entries = ranged.map(([eid, fields]) => ({ id: eid, ...fields }));
    return NextResponse.json({ streamKey, entries, store: store || 'memory' });
  } catch (err) {
    console.error('[DEBUG_PEEK] failed', err);
    return NextResponse.json({ error: 'Peek failed' }, { status: 500 });
  }
}