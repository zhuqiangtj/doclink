import { NextResponse } from 'next/server';

import { resolveExistingPatientFromScan } from '@/lib/patient-scan-auth';

type DetectedDocumentType = 'id_card' | 'medical_card' | 'unknown';

interface PatientCardLoginBody {
  socialSecurityNumber?: string | null;
  name?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  detectedDocumentType?: DetectedDocumentType | null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PatientCardLoginBody;

    if (body.detectedDocumentType !== 'medical_card') {
      return NextResponse.json(
        { error: '证件登录请扫描社保卡或医保卡，暂不支持用其他证件登录。' },
        { status: 400 }
      );
    }

    const user = await resolveExistingPatientFromScan({
      socialSecurityNumber: body.socialSecurityNumber,
      name: body.name,
      gender: body.gender,
      dateOfBirth: body.dateOfBirth,
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : '证件登录失败，请稍后重试。',
      },
      { status: 400 }
    );
  }
}
