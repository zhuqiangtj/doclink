import { NextRequest, NextResponse } from 'next/server';
import { publishDoctorEvent, publishPatientEvent, memoryPublishDoctorEvent, memoryPublishPatientEvent, filePublishDoctorEvent, filePublishPatientEvent } from '@/lib/realtime';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('kind');
  const id = searchParams.get('id');
  const type = searchParams.get('type') || 'DEBUG_EVENT';
  const payloadStr = searchParams.get('payload');
  const store = (searchParams.get('store') || '').toLowerCase();

  if (!kind || !id) {
    return NextResponse.json({ error: 'Missing kind or id' }, { status: 400 });
  }

  let payload: unknown = {};
  if (payloadStr) {
    try { payload = JSON.parse(payloadStr); } catch { payload = { raw: payloadStr }; }
  }

  try {
    if (kind === 'doctor') {
      if (store === 'memory') {
        await memoryPublishDoctorEvent(id, type, payload);
      } else if (store === 'file') {
        await filePublishDoctorEvent(id, type, payload);
      } else {
        await publishDoctorEvent(id, type, payload);
      }
    } else if (kind === 'patient') {
      if (store === 'memory') {
        await memoryPublishPatientEvent(id, type, payload);
      } else if (store === 'file') {
        await filePublishPatientEvent(id, type, payload);
      } else {
        await publishPatientEvent(id, type, payload);
      }
    } else {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }
    return NextResponse.json({ success: true, kind, id, type, store: store || 'default' });
  } catch (err) {
    console.error('[DEBUG_PUBLISH] failed', err);
    return NextResponse.json({ error: 'Publish failed' }, { status: 500 });
  }
}