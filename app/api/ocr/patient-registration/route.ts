import { NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const OCR_SPACE_FREE_MAX_FILE_SIZE = 1024 * 1024;
const OCR_SPACE_RETRY_TARGET_BYTES = 900 * 1024;
const DEFAULT_OCR_MODEL = process.env.OCR_OPENAI_MODEL || 'gpt-5-mini';
const DEFAULT_PASSWORD = '123456';
const OCR_SPACE_ENDPOINT = 'https://api.ocr.space/parse/image';

type ScanDocType = 'id_card' | 'medical_card' | 'auto';
type DetectedDocumentType = 'id_card' | 'medical_card' | 'unknown';
type OutputGender = 'Male' | 'Female' | 'Other' | null;
type OcrProvider = 'ocrspace' | 'openai';

interface OcrModelResult {
  name: string | null;
  gender: OutputGender;
  dateOfBirth: string | null;
  socialSecurityNumber: string | null;
  confidence: number | null;
  notes: string;
  detectedDocumentType: DetectedDocumentType;
}

interface ParsedOcrFields {
  name: string | null;
  gender: OutputGender;
  dateOfBirth: string | null;
  socialSecurityNumber: string | null;
  notes: string;
  detectedDocumentType: DetectedDocumentType;
  confidence: number | null;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function isSupportedDocType(value: string): value is ScanDocType {
  return value === 'id_card' || value === 'medical_card' || value === 'auto';
}

function getConfiguredProvider(): OcrProvider {
  const explicit = (process.env.OCR_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'ocrspace') return 'ocrspace';
  if (explicit === 'openai') return 'openai';
  if (process.env.OCR_SPACE_API_KEY) return 'ocrspace';
  return 'openai';
}

function buildPrompt(docType: ScanDocType): string {
  const targetDoc =
    docType === 'id_card'
      ? '中华人民共和国居民身份证正面'
      : docType === 'medical_card'
        ? '天津地区医保卡/社会保障卡上包含个人信息的一面'
        : '中华人民共和国居民身份证正面，或天津地区医保卡/社会保障卡上包含个人信息的一面';

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

function inferDocumentTypeFromText(
  rawText: string,
  docType: ScanDocType
): DetectedDocumentType {
  if (docType === 'id_card' || docType === 'medical_card') {
    return docType;
  }

  const compact = compactText(rawText).toUpperCase();

  if (
    compact.includes('社会保障卡') ||
    compact.includes('社会保障号码') ||
    compact.includes('社会保障号') ||
    compact.includes('医保') ||
    compact.includes('医疗保险')
  ) {
    return 'medical_card';
  }

  if (
    compact.includes('居民身份证') ||
    compact.includes('中华人民共和国') ||
    compact.includes('公民身份号码') ||
    compact.includes('签发机关') ||
    compact.includes('有效期限')
  ) {
    return 'id_card';
  }

  return 'unknown';
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

function firstMatch(texts: string[], patterns: RegExp[]): string | null {
  for (const text of texts) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }
  }
  return null;
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

function compactText(value: string): string {
  return value.replace(/[\s:：]/g, '');
}

function getTextLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function containsAddressLikePattern(value: string): boolean {
  if (!value) return false;
  return /\d/u.test(value);
}

function hasAddressLabelNearby(lines: string[], index: number): boolean {
  return lines
    .slice(Math.max(0, index - 1), Math.min(lines.length, index + 2))
    .some((item) => /住址/u.test(item));
}

function cleanupNameCandidate(value: string | null | undefined): string | null {
  if (!value) return null;

  const cleaned = value
    .replace(/^[姓名名\s:：]+/u, '')
    .replace(
      /(性别|民族|出生|出生日期|公民身份号码|身份证号码|身份证号|住址|有效期限|签发机关|社会保障号码|社会保障号).*$/u,
      ''
    )
    .replace(/[^\u3400-\u9FFF·]/gu, '')
    .trim();

  if (!cleaned) return null;
  if (/^(姓名|名|性别|民族|出生|住址)$/u.test(cleaned)) return null;
  if (containsAddressLikePattern(cleaned)) return null;
  if (cleaned.includes('·')) {
    if (!/^[\u3400-\u9FFF·]{2,8}$/u.test(cleaned)) return null;
  } else if (!/^[\u3400-\u9FFF]{2,4}$/u.test(cleaned)) {
    return null;
  }
  if ((cleaned.match(/·/g) || []).length > 1) return null;
  return cleaned;
}

function scoreNameCandidate(candidate: string, context: string): number {
  let score = 0;
  const lengthWithoutDot = candidate.replace(/·/g, '').length;

  if (lengthWithoutDot >= 2 && lengthWithoutDot <= 4) score += 4;
  if (candidate.includes('·')) score += 1;
  if (/姓名/u.test(context)) score += 6;
  if (/(性别|民族|出生|公民身份号码|身份证号码|身份证号)/u.test(context)) score += 2;
  if (/中华人民共和国|居民身份证/u.test(candidate)) score -= 8;

  return score;
}

function extractNameFromText(
  rawText: string,
  detectedDocumentType: DetectedDocumentType = 'unknown'
): string | null {
  const compact = compactText(rawText);
  const directMatch = firstMatch(
    [rawText, compact],
    [
      /姓名[:：]?\s*([A-Za-z\u3400-\u9FFF·]{2,10})/u,
      /姓名([A-Za-z\u3400-\u9FFF·]{2,10}?)(?=(?:性别|民族|社会保障号码|社会保障号|公民身份号码|身份证号码|身份证号|卡号|发卡日期|有效期限|有效期|$))/u,
      /名[:：]?\s*([A-Za-z\u3400-\u9FFF·]{2,10})/u,
    ]
  );

  const normalizedDirectMatch = cleanupNameCandidate(directMatch);
  if (normalizedDirectMatch) {
    return normalizedDirectMatch;
  }

  const lines = getTextLines(rawText);
  const candidates: Array<{ value: string; score: number }> = [];
  const strictIdCardMode = detectedDocumentType === 'id_card';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const compactLine = compactText(line);

    const inlineCandidate = cleanupNameCandidate(
      compactLine.match(/姓名(.{1,10})/u)?.[1] ||
        line.match(/姓名[:：]?\s*(.{1,10})/u)?.[1] ||
        null
    );
    if (inlineCandidate) {
      candidates.push({
        value: inlineCandidate,
        score: scoreNameCandidate(inlineCandidate, `${line}${lines[index + 1] || ''}`),
      });
    }

    if (/^姓名$/u.test(compactLine) || /^姓$/u.test(compactLine)) {
      for (let offset = 1; offset <= 2; offset += 1) {
        const nextLine = lines[index + offset];
        const nextCompactLine = nextLine ? compactText(nextLine) : '';
        const nextCandidate = cleanupNameCandidate(nextCompactLine || nextLine || null);
        if (nextCandidate && !hasAddressLabelNearby(lines, index + offset)) {
          candidates.push({
            value: nextCandidate,
            score: scoreNameCandidate(
              nextCandidate,
              `${line}${nextLine || ''}${lines[index + offset + 1] || ''}`
            ),
          });
        }
      }
    }

    if (strictIdCardMode) {
      continue;
    }

    const standAloneCandidate = cleanupNameCandidate(line);
    if (
      standAloneCandidate &&
      !hasAddressLabelNearby(lines, index) &&
      lines
        .slice(Math.max(0, index - 2), Math.min(lines.length, index + 3))
        .some((item) => /(性别|民族|出生|公民身份号码|身份证号码|身份证号)/u.test(item))
    ) {
      candidates.push({
        value: standAloneCandidate,
        score: scoreNameCandidate(
          standAloneCandidate,
          `${lines[index - 1] || ''}${line}${lines[index + 1] || ''}`
        ),
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.value || null;
}

function extractGenderFromText(rawText: string): OutputGender {
  const compact = compactText(rawText);
  const value = firstMatch(
    [rawText, compact],
    [
      /性别[:：]?\s*(男|女|男性|女性)/u,
      /性别(男|女|男性|女性)/u,
    ]
  );
  return normalizeGender(value);
}

function extractDateOfBirthFromText(rawText: string): string | null {
  const compact = compactText(rawText);
  const value = firstMatch(
    [rawText, compact],
    [
      /出生(?:日期)?[:：]?\s*([0-9]{4}[年./-]?[0-9]{1,2}[月./-]?[0-9]{1,2}日?)/u,
      /出生([0-9]{4}[年./-]?[0-9]{1,2}[月./-]?[0-9]{1,2}日?)/u,
      /生日[:：]?\s*([0-9]{4}[年./-]?[0-9]{1,2}[月./-]?[0-9]{1,2}日?)/u,
    ]
  );
  return normalizeDate(value);
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

function extractGovernmentIdFromText(rawText: string): string | null {
  const compact = compactText(rawText).toUpperCase();
  const labeled = firstMatch(
    [compact, rawText.toUpperCase()],
    [
      /(社会保障号码[0-9]{17}[0-9X])/u,
      /(社会保障号[0-9]{17}[0-9X])/u,
      /(公民身份号码[0-9]{17}[0-9X])/u,
      /(身份证号码[0-9]{17}[0-9X])/u,
      /(身份证号[0-9]{17}[0-9X])/u,
    ]
  );
  const fromLabel = normalizeGovernmentId(labeled);
  if (fromLabel) return fromLabel;

  const fallback = rawText.toUpperCase().match(/\b[0-9]{17}[0-9X]\b/);
  if (fallback?.[0]) {
    return normalizeGovernmentId(fallback[0]);
  }
  return normalizeGovernmentId(compact.match(/[0-9]{17}[0-9X]/)?.[0] || null);
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

async function runOcrSpace(
  fileBuffer: Buffer,
  mimeType: string,
  docType: ScanDocType
): Promise<ParsedOcrFields> {
  if (!process.env.OCR_SPACE_API_KEY) {
    throw new Error('服务器未配置 OCR.space 密钥，请先设置 OCR_SPACE_API_KEY。');
  }

  const parseImage = async (base64Image: string): Promise<string> => {
    const formData = new FormData();
    formData.append('base64Image', base64Image);
    formData.append('language', 'chs');
    formData.append('isOverlayRequired', 'false');
    formData.append('OCREngine', '2');
    formData.append('scale', 'true');

    const response = await fetch(OCR_SPACE_ENDPOINT, {
      method: 'POST',
      headers: {
        apikey: process.env.OCR_SPACE_API_KEY,
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[OCR.space] Upstream error:', text);
      throw new Error('OCR.space 识别服务暂时不可用，请稍后重试。');
    }

    const payload = (await response.json()) as {
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string[] | string;
      ErrorDetails?: string;
      ParsedResults?: Array<{ ParsedText?: string }>;
    };

    if (payload.IsErroredOnProcessing) {
      const message = Array.isArray(payload.ErrorMessage)
        ? payload.ErrorMessage.join(' ')
        : payload.ErrorMessage || payload.ErrorDetails || '';
      console.error('[OCR.space] Processing error:', payload);
      throw new Error(
        message.includes('1024 KB')
          ? 'OCR.space 免费版单张图片不能超过 1MB，请重拍或缩小图片后再试。'
          : 'OCR.space 未能完成识别，请更换清晰照片后重试。'
      );
    }

    const rawText = (payload.ParsedResults || [])
      .map((item) => item.ParsedText || '')
      .join('\n')
      .trim();

    if (!rawText) {
      throw new Error('OCR.space 未读到清晰文字，请重新拍照。');
    }

    return rawText;
  };

  const buildEnhancedRetryImage = async (): Promise<Buffer | null> => {
    try {
      let quality = 82;

      while (quality >= 56) {
        const buffer = await sharp(fileBuffer)
          .rotate()
          .resize({
            width: 2200,
            height: 2200,
            fit: 'inside',
            withoutEnlargement: false,
          })
          .grayscale()
          .normalize()
          .sharpen({ sigma: 1.2 })
          .jpeg({
            quality,
            mozjpeg: true,
          })
          .toBuffer();

        if (buffer.length <= OCR_SPACE_RETRY_TARGET_BYTES) {
          return buffer;
        }

        quality -= 6;
      }
    } catch (error) {
      console.error('[OCR.space] Failed to build retry image:', error);
    }

    return null;
  };

  const parseFieldsFromRawText = (rawText: string, retryUsed = false): ParsedOcrFields => {
    const socialSecurityNumber = extractGovernmentIdFromText(rawText);
    const textGender = extractGenderFromText(rawText);
    const textDob = extractDateOfBirthFromText(rawText);
    const detectedDocumentType = inferDocumentTypeFromText(rawText, docType);

    return {
      name: extractNameFromText(rawText, detectedDocumentType),
      gender: textGender,
      dateOfBirth: textDob,
      socialSecurityNumber,
      confidence: null,
      notes: [
        '已使用 OCR.space 识别文本，请人工核对。',
        retryUsed ? '姓名已尝试通过增强图像二次识别。' : '',
        socialSecurityNumber ? '已识别可用于推导字段的证件号码。' : '',
        detectedDocumentType === 'medical_card'
          ? '医保卡/社保卡建议优先拍姓名和社会保障号清晰的一面。'
          : detectedDocumentType === 'id_card'
            ? '身份证建议让姓名与头像一侧更靠近镜头中央。'
            : '',
      ]
        .filter(Boolean)
        .join(' '),
      detectedDocumentType,
    };
  };

  const imageUrl = toDataUrl(fileBuffer, mimeType);
  const rawText = await parseImage(imageUrl);
  const primaryResult = parseFieldsFromRawText(rawText);

  if (primaryResult.name) {
    return primaryResult;
  }

  const retryBuffer = await buildEnhancedRetryImage();
  if (!retryBuffer) {
    return primaryResult;
  }

  try {
    const retryText = await parseImage(toDataUrl(retryBuffer, 'image/jpeg'));
    const retryResult = parseFieldsFromRawText(retryText, true);

    return {
      name: retryResult.name || primaryResult.name,
      gender: retryResult.gender || primaryResult.gender,
      dateOfBirth: retryResult.dateOfBirth || primaryResult.dateOfBirth,
      socialSecurityNumber:
        retryResult.socialSecurityNumber || primaryResult.socialSecurityNumber,
      confidence: primaryResult.confidence,
      detectedDocumentType:
        primaryResult.detectedDocumentType !== 'unknown'
          ? primaryResult.detectedDocumentType
          : retryResult.detectedDocumentType,
      notes: [primaryResult.notes, retryResult.name ? '增强识别已补出姓名。' : retryResult.notes]
        .filter(Boolean)
        .join(' '),
    };
  } catch (error) {
    console.error('[OCR.space] Retry OCR failed:', error);
    return primaryResult;
  }
}

async function runOpenAiOcr(
  imageUrl: string,
  docType: ScanDocType
): Promise<ParsedOcrFields> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('服务器未配置 OPENAI_API_KEY。');
  }

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
              text: buildPrompt(docType),
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
    console.error('[OpenAI OCR] Upstream error:', errorText);
    throw new Error('证件识别失败，请稍后重试。');
  }

  const payload = await upstream.json();
  const rawText = extractResponseText(payload);
  if (!rawText) {
    console.error('[OpenAI OCR] Empty model output:', payload);
    throw new Error('未能读取到有效识别结果，请重新拍照。');
  }

  const result = parseJsonFromModel(rawText);
  return {
    name: result.name,
    gender: result.gender,
    dateOfBirth: result.dateOfBirth,
    socialSecurityNumber: result.socialSecurityNumber,
    confidence: result.confidence,
    notes: result.notes,
    detectedDocumentType: result.detectedDocumentType,
  };
}

export async function POST(request: Request) {
  const provider = getConfiguredProvider();

  if (!process.env.OCR_SPACE_API_KEY && !process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: '服务器未配置 OCR 服务密钥，请先设置 OCR_SPACE_API_KEY 或 OPENAI_API_KEY。' },
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
    if (provider === 'ocrspace' && file.size > OCR_SPACE_FREE_MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'OCR.space 免费版单张图片不能超过 1MB，请靠近重拍或裁掉背景后再试。' },
        { status: 400 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const result =
      provider === 'ocrspace'
        ? await runOcrSpace(fileBuffer, file.type, docTypeEntry)
        : await runOpenAiOcr(toDataUrl(fileBuffer, file.type), docTypeEntry);

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
      provider === 'ocrspace' ? '当前识别服务：OCR.space。' : '当前识别服务：OpenAI。',
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
      {
        error:
          error instanceof Error
            ? error.message
            : '证件识别失败，请检查图片后重试。',
      },
      { status: 500 }
    );
  }
}
