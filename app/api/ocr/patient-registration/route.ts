import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const DEFAULT_OCR_MODEL = process.env.OCR_OPENAI_MODEL || 'gpt-5-mini';
const DEFAULT_PASSWORD = '123456';

type ScanDocType = 'id_card' | 'medical_card';
type OutputGender = 'Male' | 'Female' | 'Other' | null;

interface OcrModelResult {
  name: string | null;
  gender: OutputGender;
  dateOfBirth: string | null;
  socialSecurityNumber: string | null;
  confidence: number | null;
  notes: string;
  detectedDocumentType: 'id_card' | 'medical_card' | 'unknown';
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function isSupportedDocType(value: string): value is ScanDocType {
  return value === 'id_card' || value === 'medical_card';
}

function buildPrompt(docType: ScanDocType): string {
  const targetDoc =
    docType === 'id_card'
      ? '中华人民共和国居民身份证正面'
      : '天津地区医保卡/社会保障卡上包含个人信息的一面';

  return [
    '你是医疗机构挂号登记 OCR 助手。',
    `当前图片预计是：${targetDoc}。`,
    '你的任务只有三个字段：姓名、性别、出生日期。',
    '图片可能存在轻微倾斜、旋转、透视变形、背景干扰、边缘不完全平行、卡片不在画面正中央等情况。',
    '请先理解整张图片中的证件区域，必要时在脑中将证件旋转到便于阅读的方向，再提取字段。',
    '只要关键信息仍然清晰可见，就不要因为卡片拍得有点歪或背景杂乱而放弃识别。',
    '请严格遵守以下规则：',
    '1. 只能根据图片内容提取，不要猜测，不要脑补。',
    '2. 若某个字段看不清、缺失或不确定，返回 null。',
    '3. 姓名保留证件上的中文姓名。',
    '4. 性别只能返回 Male、Female、Other 或 null。',
    '5. 出生日期必须返回 YYYY-MM-DD，无法确认就返回 null。',
    '6. 如果是医保卡或社保卡，允许额外提取 socialSecurityNumber，仅用于后台推导出生日期和性别。',
    '7. socialSecurityNumber 只返回纯数字或末位 X，无法确认就返回 null。',
    '8. 如果图片存在轻微歪斜但仍可读，notes 可以说明“图片有轻微倾斜，已按证件方向识别”。',
    '9. 如果图片存在反光、遮挡、严重模糊，notes 要明确提醒人工核对。',
    '10. notes 用一句简短中文说明识别情况，提醒人工核对。',
    '11. detectedDocumentType 根据图片判断为 id_card、medical_card 或 unknown。',
    '输出必须严格匹配 JSON Schema，不要输出额外文字。',
  ].join('\n');
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const data = payload as {
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };

  const texts: string[] = [];
  for (const item of data.output || []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        texts.push(part.text);
      }
    }
  }
  return texts.join('\n').trim();
}

function parseJsonFromModel(text: string): OcrModelResult {
  const normalizedText = text.trim();
  try {
    return JSON.parse(normalizedText) as OcrModelResult;
  } catch {
    const start = normalizedText.indexOf('{');
    const end = normalizedText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(normalizedText.slice(start, end + 1)) as OcrModelResult;
    }
    throw new Error('无法解析识别结果');
  }
}

function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (/[\u3400-\u9FFF]/.test(trimmed)) {
    return trimmed.replace(/\s+/g, '');
  }
  return trimmed.replace(/\s+/g, ' ');
}

function normalizeGender(gender: unknown): OutputGender {
  if (gender === 'Male' || gender === 'Female' || gender === 'Other') {
    return gender;
  }
  if (typeof gender !== 'string') return null;
  const value = gender.trim().toLowerCase();
  if (value === 'male' || value === '男' || value === '男性') return 'Male';
  if (value === 'female' || value === '女' || value === '女性') return 'Female';
  if (value === 'other' || value === '其他') return 'Other';
  return null;
}

function normalizeDate(dateOfBirth: string | null | undefined): string | null {
  if (!dateOfBirth) return null;
  const normalized = dateOfBirth
    .trim()
    .replace(/[年月]/g, '-')
    .replace(/[日]/g, '')
    .replace(/[./]/g, '-')
    .replace(/\s+/g, '');

  const compact = normalized.replace(/-/g, '');
  if (/^\d{8}$/.test(compact)) {
    const year = compact.slice(0, 4);
    const month = compact.slice(4, 6);
    const day = compact.slice(6, 8);
    const candidate = `${year}-${month}-${day}`;
    return isValidDate(candidate) ? candidate : null;
  }

  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = match[1];
  const month = match[2].padStart(2, '0');
  const day = match[3].padStart(2, '0');
  const candidate = `${year}-${month}-${day}`;
  return isValidDate(candidate) ? candidate : null;
}

function normalizeGovernmentId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^0-9X]/g, '');

  if (/^\d{17}[\dX]$/.test(normalized)) {
    return normalized;
  }
  return null;
}

function deriveDateOfBirthFromGovernmentId(value: string | null): string | null {
  if (!value) return null;
  const candidate = `${value.slice(6, 10)}-${value.slice(10, 12)}-${value.slice(12, 14)}`;
  return isValidDate(candidate) ? candidate : null;
}

function deriveGenderFromGovernmentId(value: string | null): OutputGender {
  if (!value) return null;
  const genderDigit = Number(value.charAt(16));
  if (Number.isNaN(genderDigit)) return null;
  return genderDigit % 2 === 0 ? 'Female' : 'Male';
}

function isValidDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > new Date().getFullYear()) return false;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function toDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: '服务器未配置 OCR 服务密钥，请先设置 OPENAI_API_KEY。' },
      { status: 503 }
    );
  }

  try {
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    const docTypeEntry = formData.get('docType');

    if (
      !fileEntry ||
      typeof fileEntry !== 'object' ||
      !('arrayBuffer' in fileEntry) ||
      !('size' in fileEntry) ||
      !('type' in fileEntry)
    ) {
      return NextResponse.json({ error: '请上传证件照片。' }, { status: 400 });
    }
    const file = fileEntry as File;
    if (typeof docTypeEntry !== 'string' || !isSupportedDocType(docTypeEntry)) {
      return NextResponse.json({ error: '证件类型无效。' }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: '上传的图片为空。' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: '图片不能超过 4MB。' }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: '仅支持 JPG、PNG、WEBP 图片。' },
        { status: 400 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const imageUrl = toDataUrl(fileBuffer, file.type);

    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_OCR_MODEL,
        store: false,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: buildPrompt(docTypeEntry),
              },
              {
                type: 'input_image',
                image_url: imageUrl,
                detail: 'high',
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'patient_registration_scan',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                name: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                },
                gender: {
                  anyOf: [
                    {
                      type: 'string',
                      enum: ['Male', 'Female', 'Other'],
                    },
                    { type: 'null' },
                  ],
                },
                dateOfBirth: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                },
                socialSecurityNumber: {
                  anyOf: [{ type: 'string' }, { type: 'null' }],
                },
                confidence: {
                  anyOf: [
                    { type: 'number', minimum: 0, maximum: 1 },
                    { type: 'null' },
                  ],
                },
                notes: {
                  type: 'string',
                },
                detectedDocumentType: {
                  type: 'string',
                  enum: ['id_card', 'medical_card', 'unknown'],
                },
              },
              required: [
                'name',
                'gender',
                'dateOfBirth',
                'socialSecurityNumber',
                'confidence',
                'notes',
                'detectedDocumentType',
              ],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text();
      console.error('[OCR] Upstream error:', errorText);
      return NextResponse.json(
        { error: '证件识别失败，请稍后重试。' },
        { status: 502 }
      );
    }

    const payload = await upstream.json();
    const rawText = extractResponseText(payload);
    if (!rawText) {
      console.error('[OCR] Empty model output:', payload);
      return NextResponse.json(
        { error: '未能读取到有效识别结果，请重新拍照。' },
        { status: 502 }
      );
    }

    const result = parseJsonFromModel(rawText);
    const normalizedName = normalizeName(result.name);
    const normalizedGenderFromText = normalizeGender(result.gender);
    const normalizedDateOfBirthFromText = normalizeDate(result.dateOfBirth);
    const normalizedGovernmentId = normalizeGovernmentId(result.socialSecurityNumber);
    const derivedDateOfBirth = deriveDateOfBirthFromGovernmentId(normalizedGovernmentId);
    const derivedGender = deriveGenderFromGovernmentId(normalizedGovernmentId);
    const normalizedGender = normalizedGenderFromText || derivedGender;
    const normalizedDateOfBirth =
      normalizedDateOfBirthFromText || derivedDateOfBirth;
    const confidence =
      typeof result.confidence === 'number'
        ? Math.max(0, Math.min(1, result.confidence))
        : null;

    const notes = [
      result.notes || '识别完成，请人工核对后提交。',
      normalizedGovernmentId
        ? '已根据社会保障号码推导可补全的字段。'
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    return NextResponse.json({
      name: normalizedName,
      gender: normalizedGender,
      dateOfBirth: normalizedDateOfBirth,
      password: DEFAULT_PASSWORD,
      confirmPassword: DEFAULT_PASSWORD,
      confidence,
      detectedDocumentType: result.detectedDocumentType,
      notes,
      shouldReview: !(normalizedName && normalizedGender && normalizedDateOfBirth),
    });
  } catch (error) {
    console.error('[OCR] Route error:', error);
    return NextResponse.json(
      { error: '证件识别失败，请检查图片后重试。' },
      { status: 500 }
    );
  }
}
