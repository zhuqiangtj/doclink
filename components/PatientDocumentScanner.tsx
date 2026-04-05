'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Loader2,
  ScanLine,
  ScanSearch,
  X,
} from 'lucide-react';

import { fetchWithTimeout } from '@/utils/network';

const SHOW_STANDARD_SCAN_UI = false;
const FRAME_WIDTH_RATIO = 0.96;
const FRAME_HEIGHT_RATIO = 0.84;
const AUTO_CAPTURE_REQUIRED_STABLE_FRAMES = 2;
const AUTO_CAPTURE_INTERVAL_MS = 450;
const AUTO_FOCUS_WARMUP_MS = 900;
const AUTO_CAPTURE_MIN_SHARPNESS = 6;
const AUTO_CAPTURE_MAX_MOTION = 26;
const AUTO_CAPTURE_MAX_BORDER_CLIPPING = 22;
const AUTO_CAPTURE_MAX_BORDER_EDGE_COVERAGE = 0.18;
const AUTO_CAPTURE_MIN_RECTANGLE_SCORE = 0.68;
const AUTO_CAPTURE_MIN_RECTANGLE_EDGE_COVERAGE = 0.56;
const AUTO_CAPTURE_MIN_RECTANGLE_AREA_RATIO = 0.18;
const AUTO_CAPTURE_MIN_RECTANGLE_MARGIN_RATIO = 0.025;
const AUTO_CAPTURE_MIN_CORNER_ROUNDNESS = 0.52;
const AUTO_TORCH_BRIGHTNESS_THRESHOLD = 72;
const AUTO_TORCH_REQUIRED_DARK_FRAMES = 3;
const CARD_LANDSCAPE_ASPECT = 1.586;
const CARD_PORTRAIT_ASPECT = 1 / CARD_LANDSCAPE_ASPECT;

type ScanDocType = 'id_card' | 'medical_card' | 'auto';
type SmartFrameFeedback = 'idle' | 'steady' | 'capturing' | 'success' | 'error';
type ScannerNoticeTone = 'success' | 'warning' | 'error';

export interface PatientDocumentScanResult {
  name: string;
  gender: 'Male' | 'Female' | 'Other' | null;
  dateOfBirth: string | null;
  socialSecurityNumber: string | null;
  password: string;
  confirmPassword: string;
  confidence: number | null;
  detectedDocumentType: 'id_card' | 'medical_card' | 'unknown';
  notes: string;
  shouldReview: boolean;
}

interface FrameMetrics {
  motion: number;
  sharpness: number;
  brightness: number;
  borderClipping: number;
  borderEdgeCoverage: number;
  rectangle: RectangleDetection;
}

interface PreviewLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RectangleDetection {
  detected: boolean;
  score: number;
  edgeCoverage: number;
  edgeStrength: number;
  areaRatio: number;
  aspectRatio: number;
  marginRatio: number;
  cornerRoundness: number;
}

interface EdgePeak {
  index: number;
  score: number;
}

interface PatientDocumentScannerProps {
  disabled?: boolean;
  onScanResult: (result: PatientDocumentScanResult) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

function smoothScores(scores: ArrayLike<number>, radius = 2): Float32Array {
  const smoothed = new Float32Array(scores.length);

  for (let index = 0; index < scores.length; index += 1) {
    let total = 0;
    let count = 0;

    for (
      let cursor = Math.max(0, index - radius);
      cursor <= Math.min(scores.length - 1, index + radius);
      cursor += 1
    ) {
      total += scores[cursor];
      count += 1;
    }

    smoothed[index] = count > 0 ? total / count : 0;
  }

  return smoothed;
}

function findTopPeaks(
  scores: ArrayLike<number>,
  start: number,
  end: number,
  count: number,
  minDistance: number
): EdgePeak[] {
  const candidates: EdgePeak[] = [];

  for (
    let index = Math.max(0, start);
    index < Math.min(scores.length, end);
    index += 1
  ) {
    candidates.push({ index, score: scores[index] });
  }

  candidates.sort((left, right) => right.score - left.score);

  const selected: EdgePeak[] = [];
  for (const candidate of candidates) {
    if (
      selected.every(
        (existing) => Math.abs(existing.index - candidate.index) >= minDistance
      )
    ) {
      selected.push(candidate);
      if (selected.length >= count) break;
    }
  }

  return selected;
}

function getCardAspectScore(aspectRatio: number): number {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return 0;

  const distanceToLandscape = Math.abs(aspectRatio - CARD_LANDSCAPE_ASPECT);
  const distanceToPortrait = Math.abs(aspectRatio - CARD_PORTRAIT_ASPECT);

  return Math.max(
    Math.max(0, 1 - distanceToLandscape / 0.55),
    Math.max(0, 1 - distanceToPortrait / 0.28)
  );
}

function getVerticalLineStats(
  gradient: Float32Array,
  width: number,
  height: number,
  x: number,
  top: number,
  bottom: number,
  threshold: number,
  bandRadius = 2
): { coverage: number; strength: number } {
  let hits = 0;
  let samples = 0;
  let totalStrength = 0;

  for (
    let y = Math.max(1, top + 1);
    y < Math.min(height - 1, bottom);
    y += 1
  ) {
    let strongest = 0;
    for (
      let cursorX = Math.max(1, x - bandRadius);
      cursorX <= Math.min(width - 2, x + bandRadius);
      cursorX += 1
    ) {
      const value = gradient[y * width + cursorX];
      if (value > strongest) strongest = value;
    }

    totalStrength += strongest;
    samples += 1;
    if (strongest >= threshold) hits += 1;
  }

  return {
    coverage: samples > 0 ? hits / samples : 0,
    strength: samples > 0 ? totalStrength / samples : 0,
  };
}

function getHorizontalLineStats(
  gradient: Float32Array,
  width: number,
  height: number,
  y: number,
  left: number,
  right: number,
  threshold: number,
  bandRadius = 2
): { coverage: number; strength: number } {
  let hits = 0;
  let samples = 0;
  let totalStrength = 0;

  for (
    let x = Math.max(1, left + 1);
    x < Math.min(width - 1, right);
    x += 1
  ) {
    let strongest = 0;
    for (
      let cursorY = Math.max(1, y - bandRadius);
      cursorY <= Math.min(height - 2, y + bandRadius);
      cursorY += 1
    ) {
      const value = gradient[cursorY * width + x];
      if (value > strongest) strongest = value;
    }

    totalStrength += strongest;
    samples += 1;
    if (strongest >= threshold) hits += 1;
  }

  return {
    coverage: samples > 0 ? hits / samples : 0,
    strength: samples > 0 ? totalStrength / samples : 0,
  };
}

function getCombinedGradientAverage(
  verticalGradient: Float32Array,
  horizontalGradient: Float32Array,
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): number {
  const safeLeft = Math.max(1, Math.min(width - 2, Math.floor(left)));
  const safeTop = Math.max(1, Math.min(height - 2, Math.floor(top)));
  const safeRight = Math.max(safeLeft + 1, Math.min(width - 1, Math.ceil(right)));
  const safeBottom = Math.max(safeTop + 1, Math.min(height - 1, Math.ceil(bottom)));

  let total = 0;
  let samples = 0;

  for (let y = safeTop; y < safeBottom; y += 1) {
    for (let x = safeLeft; x < safeRight; x += 1) {
      const index = y * width + x;
      total += Math.max(verticalGradient[index], horizontalGradient[index]);
      samples += 1;
    }
  }

  return samples > 0 ? total / samples : 0;
}

function getCornerRoundnessScore(
  verticalGradient: Float32Array,
  horizontalGradient: Float32Array,
  width: number,
  height: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
  lineThreshold: number
): number {
  const rectWidth = right - left;
  const rectHeight = bottom - top;
  const cornerWindow = Math.max(
    4,
    Math.min(14, Math.round(Math.min(rectWidth, rectHeight) * 0.08))
  );

  const verticalMidStart = top + cornerWindow;
  const verticalMidEnd = bottom - cornerWindow;
  const horizontalMidStart = left + cornerWindow;
  const horizontalMidEnd = right - cornerWindow;

  if (
    verticalMidEnd - verticalMidStart < cornerWindow * 1.2 ||
    horizontalMidEnd - horizontalMidStart < cornerWindow * 1.2
  ) {
    return 0.55;
  }

  const leftMidStats = getVerticalLineStats(
    verticalGradient,
    width,
    height,
    left,
    verticalMidStart,
    verticalMidEnd,
    lineThreshold
  );
  const rightMidStats = getVerticalLineStats(
    verticalGradient,
    width,
    height,
    right,
    verticalMidStart,
    verticalMidEnd,
    lineThreshold
  );
  const topMidStats = getHorizontalLineStats(
    horizontalGradient,
    width,
    height,
    top,
    horizontalMidStart,
    horizontalMidEnd,
    lineThreshold
  );
  const bottomMidStats = getHorizontalLineStats(
    horizontalGradient,
    width,
    height,
    bottom,
    horizontalMidStart,
    horizontalMidEnd,
    lineThreshold
  );

  const evaluateCorner = (
    verticalNear: { coverage: number; strength: number },
    verticalMid: { coverage: number; strength: number },
    horizontalNear: { coverage: number; strength: number },
    horizontalMid: { coverage: number; strength: number },
    cornerBoxStrength: number
  ) => {
    const averageMidCoverage = (verticalMid.coverage + horizontalMid.coverage) / 2;
    const averageNearCoverage = (verticalNear.coverage + horizontalNear.coverage) / 2;
    const averageMidStrength = (verticalMid.strength + horizontalMid.strength) / 2;
    const dropScore = Math.max(
      0,
      Math.min(1, (averageMidCoverage - averageNearCoverage) / 0.38)
    );
    const reliefScore = Math.max(
      0,
      Math.min(
        1,
        1 - cornerBoxStrength / Math.max(averageMidStrength * 1.02, lineThreshold)
      )
    );
    const edgeSupport = Math.max(
      0,
      Math.min(
        1,
        averageMidCoverage * 0.55 +
          Math.min(1, averageMidStrength / Math.max(lineThreshold * 1.12, 1)) * 0.45
      )
    );

    const rawRoundness = dropScore * 0.6 + reliefScore * 0.4;
    return 0.45 + rawRoundness * edgeSupport * 0.55;
  };

  const topLeftScore = evaluateCorner(
    getVerticalLineStats(
      verticalGradient,
      width,
      height,
      left,
      top,
      top + cornerWindow * 2.2,
      lineThreshold
    ),
    leftMidStats,
    getHorizontalLineStats(
      horizontalGradient,
      width,
      height,
      top,
      left,
      left + cornerWindow * 2.2,
      lineThreshold
    ),
    topMidStats,
    getCombinedGradientAverage(
      verticalGradient,
      horizontalGradient,
      width,
      height,
      left - cornerWindow * 0.3,
      top - cornerWindow * 0.3,
      left + cornerWindow * 1.15,
      top + cornerWindow * 1.15
    )
  );

  const topRightScore = evaluateCorner(
    getVerticalLineStats(
      verticalGradient,
      width,
      height,
      right,
      top,
      top + cornerWindow * 2.2,
      lineThreshold
    ),
    rightMidStats,
    getHorizontalLineStats(
      horizontalGradient,
      width,
      height,
      top,
      right - cornerWindow * 2.2,
      right,
      lineThreshold
    ),
    topMidStats,
    getCombinedGradientAverage(
      verticalGradient,
      horizontalGradient,
      width,
      height,
      right - cornerWindow * 1.15,
      top - cornerWindow * 0.3,
      right + cornerWindow * 0.3,
      top + cornerWindow * 1.15
    )
  );

  const bottomLeftScore = evaluateCorner(
    getVerticalLineStats(
      verticalGradient,
      width,
      height,
      left,
      bottom - cornerWindow * 2.2,
      bottom,
      lineThreshold
    ),
    leftMidStats,
    getHorizontalLineStats(
      horizontalGradient,
      width,
      height,
      bottom,
      left,
      left + cornerWindow * 2.2,
      lineThreshold
    ),
    bottomMidStats,
    getCombinedGradientAverage(
      verticalGradient,
      horizontalGradient,
      width,
      height,
      left - cornerWindow * 0.3,
      bottom - cornerWindow * 1.15,
      left + cornerWindow * 1.15,
      bottom + cornerWindow * 0.3
    )
  );

  const bottomRightScore = evaluateCorner(
    getVerticalLineStats(
      verticalGradient,
      width,
      height,
      right,
      bottom - cornerWindow * 2.2,
      bottom,
      lineThreshold
    ),
    rightMidStats,
    getHorizontalLineStats(
      horizontalGradient,
      width,
      height,
      bottom,
      right - cornerWindow * 2.2,
      right,
      lineThreshold
    ),
    bottomMidStats,
    getCombinedGradientAverage(
      verticalGradient,
      horizontalGradient,
      width,
      height,
      right - cornerWindow * 1.15,
      bottom - cornerWindow * 1.15,
      right + cornerWindow * 0.3,
      bottom + cornerWindow * 0.3
    )
  );

  return (topLeftScore + topRightScore + bottomLeftScore + bottomRightScore) / 4;
}

function detectRectangleCandidate(
  grayscale: Uint8ClampedArray,
  width: number,
  height: number
): RectangleDetection {
  const emptyResult: RectangleDetection = {
    detected: false,
    score: 0,
    edgeCoverage: 0,
    edgeStrength: 0,
    areaRatio: 0,
    aspectRatio: 0,
    marginRatio: 0,
    cornerRoundness: 0,
  };

  if (width < 48 || height < 48) return emptyResult;

  const verticalGradient = new Float32Array(width * height);
  const horizontalGradient = new Float32Array(width * height);
  const columnScores = new Float32Array(width);
  const rowScores = new Float32Array(height);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const verticalDiff = Math.abs(grayscale[index + 1] - grayscale[index - 1]);
      const horizontalDiff = Math.abs(
        grayscale[index + width] - grayscale[index - width]
      );
      verticalGradient[index] = verticalDiff;
      horizontalGradient[index] = horizontalDiff;
      columnScores[x] += verticalDiff;
      rowScores[y] += horizontalDiff;
    }
  }

  for (let x = 1; x < width - 1; x += 1) {
    columnScores[x] /= Math.max(1, height - 2);
  }
  for (let y = 1; y < height - 1; y += 1) {
    rowScores[y] /= Math.max(1, width - 2);
  }

  const smoothedColumns = smoothScores(columnScores, 3);
  const smoothedRows = smoothScores(rowScores, 3);
  const innerMargin = Math.max(8, Math.floor(Math.min(width, height) * 0.05));
  const peakSpacing = Math.max(8, Math.floor(Math.min(width, height) * 0.06));
  const leftPeaks = findTopPeaks(
    smoothedColumns,
    innerMargin,
    Math.floor(width * 0.48),
    4,
    peakSpacing
  );
  const rightPeaks = findTopPeaks(
    smoothedColumns,
    Math.floor(width * 0.52),
    width - innerMargin,
    4,
    peakSpacing
  );
  const topPeaks = findTopPeaks(
    smoothedRows,
    innerMargin,
    Math.floor(height * 0.48),
    4,
    peakSpacing
  );
  const bottomPeaks = findTopPeaks(
    smoothedRows,
    Math.floor(height * 0.52),
    height - innerMargin,
    4,
    peakSpacing
  );

  if (
    leftPeaks.length === 0 ||
    rightPeaks.length === 0 ||
    topPeaks.length === 0 ||
    bottomPeaks.length === 0
  ) {
    return emptyResult;
  }

  const meanColumnScore =
    smoothedColumns.reduce((total, value) => total + value, 0) /
    Math.max(1, smoothedColumns.length);
  const meanRowScore =
    smoothedRows.reduce((total, value) => total + value, 0) /
    Math.max(1, smoothedRows.length);
  const baseThreshold = Math.max(
    18,
    Math.min(46, (meanColumnScore + meanRowScore) * 1.12)
  );

  let bestResult = emptyResult;

  for (const left of leftPeaks) {
    for (const right of rightPeaks) {
      const rectWidth = right.index - left.index;
      if (rectWidth < width * 0.28 || rectWidth > width * 0.94) continue;

      for (const top of topPeaks) {
        for (const bottom of bottomPeaks) {
          const rectHeight = bottom.index - top.index;
          if (rectHeight < height * 0.18 || rectHeight > height * 0.82) continue;

          const aspectRatio = rectWidth / rectHeight;
          const aspectScore = getCardAspectScore(aspectRatio);
          if (aspectScore <= 0.1) continue;

          const areaRatio = (rectWidth * rectHeight) / (width * height);
          if (areaRatio < 0.14 || areaRatio > 0.88) continue;

          const minMargin = Math.min(
            left.index,
            width - right.index,
            top.index,
            height - bottom.index
          );
          const marginRatio = minMargin / Math.min(width, height);
          if (marginRatio < 0.015) continue;

          const lineThreshold = Math.max(
            baseThreshold,
            ((left.score + right.score + top.score + bottom.score) / 4) * 0.78
          );
          const leftStats = getVerticalLineStats(
            verticalGradient,
            width,
            height,
            left.index,
            top.index,
            bottom.index,
            lineThreshold
          );
          const rightStats = getVerticalLineStats(
            verticalGradient,
            width,
            height,
            right.index,
            top.index,
            bottom.index,
            lineThreshold
          );
          const topStats = getHorizontalLineStats(
            horizontalGradient,
            width,
            height,
            top.index,
            left.index,
            right.index,
            lineThreshold
          );
          const bottomStats = getHorizontalLineStats(
            horizontalGradient,
            width,
            height,
            bottom.index,
            left.index,
            right.index,
            lineThreshold
          );

          const minCoverage = Math.min(
            leftStats.coverage,
            rightStats.coverage,
            topStats.coverage,
            bottomStats.coverage
          );
          const averageCoverage =
            (leftStats.coverage +
              rightStats.coverage +
              topStats.coverage +
              bottomStats.coverage) /
            4;
          if (minCoverage < 0.4 || averageCoverage < 0.5) continue;

          const edgeStrength =
            (leftStats.strength +
              rightStats.strength +
              topStats.strength +
              bottomStats.strength) /
            4;
          const cornerRoundness = getCornerRoundnessScore(
            verticalGradient,
            horizontalGradient,
            width,
            height,
            left.index,
            right.index,
            top.index,
            bottom.index,
            lineThreshold
          );
          const strengthScore = Math.min(1, edgeStrength / 44);
          const areaScore = Math.min(1, areaRatio / 0.32);
          const marginScore = Math.min(1, marginRatio / 0.08);
          const baseScore =
            averageCoverage * 0.34 +
            minCoverage * 0.22 +
            aspectScore * 0.18 +
            strengthScore * 0.14 +
            areaScore * 0.07 +
            marginScore * 0.05;
          const score = baseScore * 0.85 + cornerRoundness * 0.15;

          if (score > bestResult.score) {
            bestResult = {
              detected: score >= AUTO_CAPTURE_MIN_RECTANGLE_SCORE,
              score,
              edgeCoverage: averageCoverage,
              edgeStrength,
              areaRatio,
              aspectRatio,
              marginRatio,
              cornerRoundness,
            };
          }
        }
      }
    }
  }

  return bestResult;
}

function scoreRearCameraDevice(device: MediaDeviceInfo): number {
  const label = device.label.toLowerCase();
  let score = 0;

  if (/front|user|前置|前摄|自拍|facetime/i.test(label)) {
    return -1000;
  }

  if (/back|rear|environment|后置|后摄/i.test(label)) score += 80;
  if (/wide|main|standard|normal|广角|主摄|标准/i.test(label)) score += 35;
  if (/tele|telephoto|长焦|macro|微距|depth|景深|bokeh/i.test(label)) score -= 45;
  if (/ultra|超广/i.test(label)) score -= 18;
  if (/0,\s*facing\s*back|camera0|cam0/i.test(label)) score += 20;

  return score;
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('无法读取图片，请重新选择。'));
      img.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('图片压缩失败，请重试。'));
    }, type, quality);
  });
}

async function prepareImageForVercelUpload(file: File): Promise<File> {
  const TARGET_MAX_BYTES = 950 * 1024;
  const SAFE_TARGET_BYTES = 900 * 1024;

  if (file.size <= SAFE_TARGET_BYTES) return file;

  const image = await loadImageFromFile(file);
  const maxEdge = 1800;
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('当前浏览器不支持图片压缩，请换一个浏览器重试。');
  }
  context.drawImage(image, 0, 0, width, height);

  const qualities = [0.82, 0.68, 0.56, 0.46];
  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= TARGET_MAX_BYTES) {
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'scan'}.jpg`, {
        type: 'image/jpeg',
      });
    }
  }

  throw new Error('图片仍然过大，请靠近一点重拍，或裁掉多余背景后再试。');
}

export default function PatientDocumentScanner({
  disabled = false,
  onScanResult,
  onBusyChange,
}: PatientDocumentScannerProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<ScannerNoticeTone>('success');
  const [isScanning, setIsScanning] = useState(false);
  const [smartCameraOpen, setSmartCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isAutoCapturing, setIsAutoCapturing] = useState(false);
  const [cameraHint, setCameraHint] = useState('把证件放进大框里');
  const [stableFrameCount, setStableFrameCount] = useState(0);
  const [frameFeedback, setFrameFeedback] = useState<SmartFrameFeedback>('idle');
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);
  const [previewLayout, setPreviewLayout] = useState<PreviewLayout | null>(null);

  const scanDocType: ScanDocType = 'auto';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const smartViewportRef = useRef<HTMLDivElement | null>(null);
  const smartVideoRef = useRef<HTMLVideoElement | null>(null);
  const smartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const smartStreamRef = useRef<MediaStream | null>(null);
  const smartAutoCaptureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameRef = useRef<Uint8ClampedArray | null>(null);
  const autoCapturedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastStableSignalRef = useRef(false);
  const darkFrameCountRef = useRef(0);
  const torchAttemptedRef = useRef(false);
  const autoCaptureReadyAtRef = useRef(0);

  useEffect(() => {
    onBusyChange?.(isScanning || isAutoCapturing);
  }, [isAutoCapturing, isScanning, onBusyChange]);

  useEffect(() => {
    return () => {
      if (smartAutoCaptureTimerRef.current) {
        clearInterval(smartAutoCaptureTimerRef.current);
        smartAutoCaptureTimerRef.current = null;
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
      stopSmartCameraStream();
    };
  }, []);

  const setScannerNotice = (message: string | null, tone: ScannerNoticeTone = 'success') => {
    setNotice(message);
    setNoticeTone(tone);
  };

  const vibrateDevice = (pattern: number | number[]) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  };

  const playTone = (
    frequency: number,
    durationMs: number,
    volume = 0.05,
    type: OscillatorType = 'sine'
  ) => {
    if (typeof window === 'undefined') return;

    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) return;

    try {
      const context = audioContextRef.current || new AudioContextCtor();
      audioContextRef.current = context;
      if (context.state === 'suspended') {
        void context.resume();
      }

      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      const startAt = context.currentTime;
      const endAt = startAt + durationMs / 1000;

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt);
    } catch (error) {
      console.warn('Unable to play camera feedback tone:', error);
    }
  };

  const triggerFeedback = (kind: SmartFrameFeedback) => {
    if (kind === 'steady') {
      vibrateDevice([85, 30, 95]);
      playTone(1020, 170, 0.11, 'triangle');
      window.setTimeout(() => playTone(1240, 150, 0.09, 'triangle'), 120);
      return;
    }

    if (kind === 'capturing') {
      vibrateDevice([130, 45, 150, 40, 180]);
      playTone(1420, 190, 0.13, 'triangle');
      window.setTimeout(() => playTone(1760, 180, 0.12, 'triangle'), 120);
      window.setTimeout(() => playTone(2120, 180, 0.1, 'triangle'), 250);
      return;
    }

    if (kind === 'success') {
      vibrateDevice([120, 40, 150, 40, 220]);
      playTone(1560, 190, 0.12, 'sine');
      window.setTimeout(() => playTone(1980, 200, 0.11, 'sine'), 120);
      window.setTimeout(() => playTone(2280, 220, 0.1, 'sine'), 280);
      return;
    }

    if (kind === 'error') {
      vibrateDevice([160, 55, 170, 55, 180]);
      playTone(240, 260, 0.1, 'sawtooth');
      window.setTimeout(() => playTone(200, 240, 0.09, 'sawtooth'), 180);
    }
  };

  const getSmartVideoTrack = () => smartStreamRef.current?.getVideoTracks?.()[0] || null;

  const detectTorchAvailability = () => {
    const track = getSmartVideoTrack();
    if (!track || typeof track.getCapabilities !== 'function') {
      setTorchAvailable(false);
      return false;
    }

    try {
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
        torch?: boolean | boolean[];
      };
      const torchCapability = capabilities.torch;
      const available = Array.isArray(torchCapability)
        ? torchCapability.includes(true)
        : Boolean(torchCapability);
      setTorchAvailable(available);
      return available;
    } catch (error) {
      console.warn('Unable to detect torch capability:', error);
      setTorchAvailable(false);
      return false;
    }
  };

  const setTorchMode = async (enabled: boolean) => {
    const track = getSmartVideoTrack();
    if (!track || typeof track.applyConstraints !== 'function') {
      return false;
    }

    try {
      await track.applyConstraints({
        advanced: [{ torch: enabled } as MediaTrackConstraintSet],
      });
      setTorchEnabled(enabled);
      return true;
    } catch (error) {
      console.warn(`Unable to ${enabled ? 'enable' : 'disable'} torch:`, error);
      return false;
    }
  };

  const tryEnableContinuousFocus = async () => {
    const track = getSmartVideoTrack();
    if (!track || typeof track.applyConstraints !== 'function') {
      return false;
    }

    try {
      const capabilities = typeof track.getCapabilities === 'function'
        ? (track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[] })
        : null;

      if (Array.isArray(capabilities?.focusMode) && capabilities.focusMode.includes('continuous')) {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
        });
        return true;
      }
    } catch (error) {
      console.warn('Unable to enable continuous focus:', error);
    }

    return false;
  };

  const tryNormalizeSmartCameraZoom = async () => {
    const track = getSmartVideoTrack();
    if (!track || typeof track.applyConstraints !== 'function') {
      return false;
    }

    try {
      const capabilities =
        typeof track.getCapabilities === 'function'
          ? (track.getCapabilities() as MediaTrackCapabilities & {
              zoom?: { min?: number; max?: number };
            })
          : null;

      const zoomCapability = capabilities?.zoom;
      if (!zoomCapability || typeof zoomCapability !== 'object') return false;

      const minZoom =
        typeof zoomCapability.min === 'number' ? zoomCapability.min : undefined;
      const maxZoom =
        typeof zoomCapability.max === 'number' ? zoomCapability.max : undefined;

      if (typeof minZoom !== 'number' || typeof maxZoom !== 'number') {
        return false;
      }

      const targetZoom = minZoom <= 1 && maxZoom >= 1 ? 1 : minZoom;
      await track.applyConstraints({
        advanced: [{ zoom: targetZoom } as MediaTrackConstraintSet],
      });
      return true;
    } catch (error) {
      console.warn('Unable to normalize smart camera zoom:', error);
    }

    return false;
  };

  const buildSmartCameraConstraints = (deviceId?: string): MediaStreamConstraints => ({
    audio: false,
    video: deviceId
      ? {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 960 },
          aspectRatio: { ideal: 4 / 3 },
        }
      : {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 960 },
          aspectRatio: { ideal: 4 / 3 },
        },
  });

  const pickPreferredRearCamera = async (): Promise<string | null> => {
    if (!navigator.mediaDevices?.enumerateDevices) return null;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((device) => device.kind === 'videoinput');
      if (videoInputs.length === 0) return null;

      const sorted = [...videoInputs].sort(
        (left, right) => scoreRearCameraDevice(right) - scoreRearCameraDevice(left)
      );
      const best = sorted[0];
      return scoreRearCameraDevice(best) > 0 ? best.deviceId : null;
    } catch (error) {
      console.warn('Unable to enumerate video devices:', error);
      return null;
    }
  };

  const computePreviewLayout = (video: HTMLVideoElement): PreviewLayout | null => {
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const viewportWidth = smartViewportRef.current?.clientWidth || video.clientWidth || videoWidth;
    const viewportHeight =
      smartViewportRef.current?.clientHeight || video.clientHeight || videoHeight;

    if (!viewportWidth || !viewportHeight || !videoWidth || !videoHeight) {
      return null;
    }

    const fitScale = Math.min(viewportWidth / videoWidth, viewportHeight / videoHeight);
    const renderedWidth = Math.max(1, Math.floor(videoWidth * fitScale));
    const renderedHeight = Math.max(1, Math.floor(videoHeight * fitScale));

    return {
      left: Math.floor((viewportWidth - renderedWidth) / 2),
      top: Math.floor((viewportHeight - renderedHeight) / 2),
      width: renderedWidth,
      height: renderedHeight,
    };
  };

  const updatePreviewLayout = () => {
    const video = smartVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    setPreviewLayout(computePreviewLayout(video));
  };

  const getFrameCrop = (video: HTMLVideoElement) => {
    const layout =
      computePreviewLayout(video) || {
        left: 0,
        top: 0,
        width: video.videoWidth,
        height: video.videoHeight,
      };
    const frameWidth = layout.width * FRAME_WIDTH_RATIO;
    const frameHeight = layout.height * FRAME_HEIGHT_RATIO;
    const frameLeft = layout.left + (layout.width - frameWidth) / 2;
    const frameTop = layout.top + (layout.height - frameHeight) / 2;
    const relativeLeft = (frameLeft - layout.left) / layout.width;
    const relativeTop = (frameTop - layout.top) / layout.height;
    const relativeWidth = frameWidth / layout.width;
    const relativeHeight = frameHeight / layout.height;

    const sx = Math.max(0, Math.floor(video.videoWidth * relativeLeft));
    const sy = Math.max(0, Math.floor(video.videoHeight * relativeTop));
    const sw = Math.min(video.videoWidth - sx, Math.floor(video.videoWidth * relativeWidth));
    const sh = Math.min(video.videoHeight - sy, Math.floor(video.videoHeight * relativeHeight));

    return {
      sx,
      sy,
      sw: Math.max(1, sw),
      sh: Math.max(1, sh),
    };
  };

  const measureFrame = (
    context: CanvasRenderingContext2D,
    width: number,
    height: number
  ): FrameMetrics => {
    const { data } = context.getImageData(0, 0, width, height);
    const grayscale = new Uint8ClampedArray(width * height);
    let sharpnessTotal = 0;

    for (let i = 0, pixelIndex = 0; i < data.length; i += 4, pixelIndex += 1) {
      grayscale[pixelIndex] = Math.round(
        data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      );
    }

    let brightnessTotal = 0;
    for (let i = 0; i < grayscale.length; i += 1) {
      brightnessTotal += grayscale[i];
    }

    const borderBand = Math.max(6, Math.floor(Math.min(width, height) * 0.06));
    let borderClippingTotal = 0;
    let borderClippingSamples = 0;
    const strongEdgeThreshold = 34;
    let leftEdgeHits = 0;
    let rightEdgeHits = 0;
    let topEdgeHits = 0;
    let bottomEdgeHits = 0;
    let leftEdgeSamples = 0;
    let rightEdgeSamples = 0;
    let topEdgeSamples = 0;
    let bottomEdgeSamples = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < borderBand; x += 1) {
        const diff = Math.abs(grayscale[y * width + x] - grayscale[y * width + x + 1]);
        borderClippingTotal += diff;
        borderClippingSamples += 1;
        leftEdgeSamples += 1;
        if (diff >= strongEdgeThreshold) leftEdgeHits += 1;
      }

      for (let x = width - borderBand; x < width; x += 1) {
        const diff = Math.abs(grayscale[y * width + x] - grayscale[y * width + x - 1]);
        borderClippingTotal += diff;
        borderClippingSamples += 1;
        rightEdgeSamples += 1;
        if (diff >= strongEdgeThreshold) rightEdgeHits += 1;
      }
    }

    for (let y = 0; y < borderBand; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const diff = Math.abs(grayscale[y * width + x] - grayscale[(y + 1) * width + x]);
        borderClippingTotal += diff;
        borderClippingSamples += 1;
        topEdgeSamples += 1;
        if (diff >= strongEdgeThreshold) topEdgeHits += 1;
      }
    }

    for (let y = height - borderBand; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const diff = Math.abs(grayscale[y * width + x] - grayscale[(y - 1) * width + x]);
        borderClippingTotal += diff;
        borderClippingSamples += 1;
        bottomEdgeSamples += 1;
        if (diff >= strongEdgeThreshold) bottomEdgeHits += 1;
      }
    }

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const center = grayscale[y * width + x];
        const right = grayscale[y * width + x + 1];
        const left = grayscale[y * width + x - 1];
        const top = grayscale[(y - 1) * width + x];
        const bottom = grayscale[(y + 1) * width + x];
        sharpnessTotal += Math.abs(right - left) + Math.abs(bottom - top) + Math.abs(center - right);
      }
    }

    let motionTotal = 0;
    const previous = lastFrameRef.current;
    if (previous && previous.length === grayscale.length) {
      for (let i = 0; i < grayscale.length; i += 16) {
        motionTotal += Math.abs(grayscale[i] - previous[i]);
      }
      motionTotal /= grayscale.length / 16;
    }

    lastFrameRef.current = grayscale;
    const rectangle = detectRectangleCandidate(grayscale, width, height);

    return {
      motion: motionTotal,
      sharpness: sharpnessTotal / (width * height),
      brightness: brightnessTotal / grayscale.length,
      borderClipping:
        borderClippingSamples > 0 ? borderClippingTotal / borderClippingSamples : 0,
      borderEdgeCoverage: Math.max(
        leftEdgeSamples > 0 ? leftEdgeHits / leftEdgeSamples : 0,
        rightEdgeSamples > 0 ? rightEdgeHits / rightEdgeSamples : 0,
        topEdgeSamples > 0 ? topEdgeHits / topEdgeSamples : 0,
        bottomEdgeSamples > 0 ? bottomEdgeHits / bottomEdgeSamples : 0
      ),
      rectangle,
    };
  };

  const stopSmartCameraFeed = () => {
    if (smartAutoCaptureTimerRef.current) {
      clearInterval(smartAutoCaptureTimerRef.current);
      smartAutoCaptureTimerRef.current = null;
    }
    if (smartStreamRef.current) {
      for (const track of smartStreamRef.current.getTracks()) {
        track.stop();
      }
      smartStreamRef.current = null;
    }
    if (smartVideoRef.current) {
      smartVideoRef.current.srcObject = null;
    }
    lastFrameRef.current = null;
    autoCapturedRef.current = false;
    lastStableSignalRef.current = false;
    darkFrameCountRef.current = 0;
    torchAttemptedRef.current = false;
    setStableFrameCount(0);
    setCameraReady(false);
    setTorchAvailable(false);
    setTorchEnabled(false);
    autoCaptureReadyAtRef.current = 0;
    setPreviewLayout(null);
  };

  const stopSmartCameraStream = () => {
    stopSmartCameraFeed();
    setIsAutoCapturing(false);
    setFrameFeedback('idle');
    setCapturedPreviewUrl(null);
  };

  const closeSmartCamera = () => {
    stopSmartCameraStream();
    setSmartCameraOpen(false);
    setCameraError(null);
    setCameraHint('把证件放进大框里');
    setFrameFeedback('idle');
    setCapturedPreviewUrl(null);
  };

  const openSmartCamera = () => {
    setCameraError(null);
    setCameraHint('把证件放进大框里');
    setFrameFeedback('idle');
    setCapturedPreviewUrl(null);
    setPreviewLayout(null);
    setScannerNotice(null);
    setSmartCameraOpen(true);
  };

  const uploadScanFile = async (file: File) => {
    setIsScanning(true);
    setScannerNotice(null);

    try {
      const uploadFile = await prepareImageForVercelUpload(file);
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('docType', scanDocType);

      const response = await fetchWithTimeout(
        '/api/ocr/patient-registration',
        {
          method: 'POST',
          body: formData,
        },
        45000
      );

      const data = (await response.json()) as PatientDocumentScanResult | { error?: string };
      if (!response.ok) {
        throw new Error(
          'error' in data && typeof data.error === 'string'
            ? data.error
            : '证件识别失败，请重试。'
        );
      }

      const result = data as PatientDocumentScanResult;
      await onScanResult(result);

      setScannerNotice(
        result.notes || (result.shouldReview ? '证件信息已回填，请人工核对后保存。' : '证件信息已回填。'),
        result.shouldReview ? 'warning' : 'success'
      );
    } catch (err) {
      setScannerNotice(
        err instanceof Error ? err.message : '证件识别失败，请重试。',
        'error'
      );
      throw err;
    } finally {
      setIsScanning(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleScanFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await uploadScanFile(file);
    } catch {
      // handled above
    }
  };

  const captureSmartCameraFrame = async () => {
    if (isScanning || isAutoCapturing) return;

    const video = smartVideoRef.current;
    const canvas = smartCanvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraError('相机尚未准备好，请稍后再试。');
      return;
    }

    setIsAutoCapturing(true);
    setCameraHint('正在拍照…');
    setFrameFeedback('capturing');
    triggerFeedback('capturing');

    try {
      const crop = getFrameCrop(video);
      canvas.width = crop.sw;
      canvas.height = crop.sh;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('当前浏览器不支持相机画面处理。');
      }

      context.drawImage(
        video,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        0,
        0,
        crop.sw,
        crop.sh
      );

      setCapturedPreviewUrl(canvas.toDataURL('image/jpeg', 0.9));
      setCameraHint('照片已拍好，正在识别，可放下手机等待');
      stopSmartCameraFeed();

      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      const file = new File([blob], `smart-scan-${Date.now()}.jpg`, {
        type: 'image/jpeg',
      });

      await uploadScanFile(file);
      setFrameFeedback('success');
      triggerFeedback('success');
      closeSmartCamera();
    } catch (err) {
      setCameraError(
        err instanceof Error ? err.message : '智能扫描失败，请稍后重试。'
      );
      setCameraHint('请重新对准后再试');
      setFrameFeedback('error');
      setCapturedPreviewUrl(null);
      triggerFeedback('error');
      autoCapturedRef.current = false;
      lastStableSignalRef.current = false;
    } finally {
      setIsAutoCapturing(false);
    }
  };

  useEffect(() => {
    if (!smartCameraOpen) return;
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('当前浏览器不支持网页内相机，请换浏览器或稍后重试。');
      return;
    }

    let cancelled = false;

    const startSmartCamera = async () => {
      setCameraError(null);
      setCameraReady(false);
      setCameraHint('正在打开相机…');

      try {
        let stream = await navigator.mediaDevices.getUserMedia(
          buildSmartCameraConstraints()
        );

        const preferredRearCameraId = await pickPreferredRearCamera();
        const currentTrack = stream.getVideoTracks()[0];
        const currentDeviceId = currentTrack?.getSettings().deviceId;

        if (preferredRearCameraId && preferredRearCameraId !== currentDeviceId) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          stream = await navigator.mediaDevices.getUserMedia(
            buildSmartCameraConstraints(preferredRearCameraId)
          );
        }

        if (cancelled) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }

        smartStreamRef.current = stream;
        if (smartVideoRef.current) {
          smartVideoRef.current.srcObject = stream;
          await smartVideoRef.current.play();
        }
        await tryNormalizeSmartCameraZoom();
        await tryEnableContinuousFocus();
        autoCaptureReadyAtRef.current = Date.now() + AUTO_FOCUS_WARMUP_MS;
        detectTorchAvailability();
        updatePreviewLayout();
        setCameraReady(true);
        setCameraHint('请稍等对焦，然后把证件完整放进框里');
        setFrameFeedback('idle');
      } catch (err) {
        console.error('[Smart Camera] Failed to start:', err);
        setCameraError('无法打开相机，请检查权限后重试。');
        setFrameFeedback('error');
      }
    };

    startSmartCamera();

    return () => {
      cancelled = true;
      stopSmartCameraStream();
    };
  }, [smartCameraOpen]);

  useEffect(() => {
    if (!smartCameraOpen || !cameraReady || cameraError) return;

    const canvas = smartCanvasRef.current;
    const video = smartVideoRef.current;
    if (!canvas || !video) return;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    smartAutoCaptureTimerRef.current = setInterval(() => {
      if (
        autoCapturedRef.current ||
        isScanning ||
        isAutoCapturing ||
        !video.videoWidth ||
        !video.videoHeight ||
        Date.now() < autoCaptureReadyAtRef.current
      ) {
        return;
      }

      const crop = getFrameCrop(video);
      const sampleWidth = 160;
      const sampleHeight = 220;
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;
      context.drawImage(
        video,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        0,
        0,
        sampleWidth,
        sampleHeight
      );

      const metrics = measureFrame(context, sampleWidth, sampleHeight);
      const hasRectangleCandidate =
        metrics.rectangle.detected &&
        metrics.rectangle.edgeCoverage >= AUTO_CAPTURE_MIN_RECTANGLE_EDGE_COVERAGE &&
        metrics.rectangle.areaRatio >= AUTO_CAPTURE_MIN_RECTANGLE_AREA_RATIO &&
        metrics.rectangle.marginRatio >= AUTO_CAPTURE_MIN_RECTANGLE_MARGIN_RATIO &&
        metrics.rectangle.cornerRoundness >= AUTO_CAPTURE_MIN_CORNER_ROUNDNESS;
      const isStable =
        hasRectangleCandidate &&
        metrics.sharpness >= AUTO_CAPTURE_MIN_SHARPNESS &&
        metrics.motion <= AUTO_CAPTURE_MAX_MOTION &&
        metrics.borderClipping <= AUTO_CAPTURE_MAX_BORDER_CLIPPING &&
        metrics.borderEdgeCoverage <= AUTO_CAPTURE_MAX_BORDER_EDGE_COVERAGE;
      const isDark = metrics.brightness <= AUTO_TORCH_BRIGHTNESS_THRESHOLD;

      if (torchAvailable && !torchEnabled && !torchAttemptedRef.current) {
        darkFrameCountRef.current = isDark ? darkFrameCountRef.current + 1 : 0;

        if (darkFrameCountRef.current >= AUTO_TORCH_REQUIRED_DARK_FRAMES) {
          torchAttemptedRef.current = true;
          void setTorchMode(true).then((enabled) => {
            if (enabled) {
              setCameraHint('光线较暗，已自动打开补光');
            }
          });
        }
      } else if (!isDark) {
        darkFrameCountRef.current = 0;
      }

      setStableFrameCount((current) => {
        const next = isStable ? current + 1 : 0;
        if (isStable) {
          setFrameFeedback(next >= AUTO_CAPTURE_REQUIRED_STABLE_FRAMES ? 'capturing' : 'steady');
          if (!lastStableSignalRef.current) {
            lastStableSignalRef.current = true;
            triggerFeedback('steady');
          }
          setCameraHint(
            `已进入框内，保持不动 ${Math.min(next, AUTO_CAPTURE_REQUIRED_STABLE_FRAMES)}/${AUTO_CAPTURE_REQUIRED_STABLE_FRAMES}`
          );
        } else if (
          metrics.borderClipping > AUTO_CAPTURE_MAX_BORDER_CLIPPING ||
          metrics.borderEdgeCoverage > AUTO_CAPTURE_MAX_BORDER_EDGE_COVERAGE
        ) {
          lastStableSignalRef.current = false;
          setFrameFeedback('idle');
          setCameraHint('证件还没完全进框，先把四边都收进虚框里');
        } else if (!metrics.rectangle.detected) {
          lastStableSignalRef.current = false;
          setFrameFeedback('idle');
          setCameraHint('先把完整矩形证件放进框里，露出四条边');
        } else if (
          metrics.rectangle.areaRatio < AUTO_CAPTURE_MIN_RECTANGLE_AREA_RATIO ||
          metrics.rectangle.marginRatio < AUTO_CAPTURE_MIN_RECTANGLE_MARGIN_RATIO
        ) {
          lastStableSignalRef.current = false;
          setFrameFeedback('idle');
          setCameraHint('证件要完整入框并再靠近一点');
        } else if (
          metrics.rectangle.edgeCoverage < AUTO_CAPTURE_MIN_RECTANGLE_EDGE_COVERAGE
        ) {
          lastStableSignalRef.current = false;
          setFrameFeedback('idle');
          setCameraHint('请让证件四条边更完整、更平直地落在框里');
        } else if (
          metrics.rectangle.cornerRoundness < AUTO_CAPTURE_MIN_CORNER_ROUNDNESS
        ) {
          lastStableSignalRef.current = false;
          setFrameFeedback('idle');
          setCameraHint('请把证件正对镜头，四角完整露出来');
        } else if (metrics.motion > AUTO_CAPTURE_MAX_MOTION) {
          lastStableSignalRef.current = false;
          setFrameFeedback('idle');
          setCameraHint('把证件放进大框里并保持不动');
        } else if (metrics.sharpness < AUTO_CAPTURE_MIN_SHARPNESS) {
          lastStableSignalRef.current = false;
          setFrameFeedback('idle');
          setCameraHint('稍微靠近一点就会自动拍');
        } else {
          lastStableSignalRef.current = false;
          setFrameFeedback('idle');
          setCameraHint('保持不动，马上自动拍');
        }

        if (next >= AUTO_CAPTURE_REQUIRED_STABLE_FRAMES && !autoCapturedRef.current) {
          autoCapturedRef.current = true;
          void captureSmartCameraFrame();
        }
        return next;
      });
    }, AUTO_CAPTURE_INTERVAL_MS);

    return () => {
      if (smartAutoCaptureTimerRef.current) {
        clearInterval(smartAutoCaptureTimerRef.current);
        smartAutoCaptureTimerRef.current = null;
      }
    };
  }, [cameraError, cameraReady, isAutoCapturing, isScanning, smartCameraOpen, torchAvailable, torchEnabled]);

  useEffect(() => {
    if (!smartCameraOpen || !cameraReady) return;

    const handleResize = () => {
      updatePreviewLayout();
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [cameraReady, smartCameraOpen]);

  const openScanPicker = () => {
    setScannerNotice(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  return (
    <>
      <style jsx global>{`
        @keyframes patient-smart-scan-line {
          0% {
            transform: translateY(0);
          }
          100% {
            transform: translateY(calc(100% - 0.375rem));
          }
        }

        .patient-smart-scan-line {
          animation: patient-smart-scan-line 1s linear infinite alternate;
        }
      `}</style>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        capture="environment"
        className="hidden"
        onChange={handleScanFileChange}
      />

      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">证件识别补录</p>
            <p className="text-xs text-slate-500">支持社保卡、医保卡、身份证，识别后自动覆盖可识别字段</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openSmartCamera}
              disabled={disabled || isScanning}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {smartCameraOpen && (cameraReady || isAutoCapturing) ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ScanLine size={16} />
              )}
              智能扫描
            </button>
            {SHOW_STANDARD_SCAN_UI ? (
              <button
                type="button"
                onClick={openScanPicker}
                disabled={disabled || isScanning}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isScanning ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ScanSearch size={16} />
                )}
                普通扫描
              </button>
            ) : null}
          </div>
        </div>

        {notice && (
          <div
            className={`mt-3 rounded-xl px-3 py-2 text-xs ${
              noticeTone === 'error'
                ? 'bg-red-50 text-red-700'
                : noticeTone === 'warning'
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {notice}
          </div>
        )}
      </div>

      {smartCameraOpen && (
        <div className="fixed inset-0 z-[1200] bg-black/80 px-2 py-3 sm:px-4 sm:py-6">
          <div className="mx-auto flex h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
              <div>
                <h2 className="text-lg font-semibold">智能扫描</h2>
                <p className="text-xs text-white/70">对准社保卡或身份证，自动对焦后拍照识别</p>
              </div>
              <button
                type="button"
                onClick={closeSmartCamera}
                className="rounded-full p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
                aria-label="关闭智能扫描"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-4">
              <div
                ref={smartViewportRef}
                className="relative flex-1 overflow-hidden rounded-3xl bg-black"
              >
                <video
                  ref={smartVideoRef}
                  className="absolute h-full w-full object-fill"
                  autoPlay
                  muted
                  playsInline
                  onLoadedMetadata={updatePreviewLayout}
                  style={
                    previewLayout
                      ? {
                          left: `${previewLayout.left}px`,
                          top: `${previewLayout.top}px`,
                          width: `${previewLayout.width}px`,
                          height: `${previewLayout.height}px`,
                        }
                      : { inset: 0 }
                  }
                />
                <div className="pointer-events-none absolute inset-0 bg-black/35" />
                {capturedPreviewUrl && (
                  <div className="pointer-events-none absolute inset-0 bg-slate-950/22" />
                )}
                {capturedPreviewUrl && (
                  <div
                    className="pointer-events-none absolute z-[1] overflow-hidden rounded-2xl"
                    style={{
                      left: previewLayout
                        ? `${previewLayout.left + (previewLayout.width * (1 - FRAME_WIDTH_RATIO)) / 2}px`
                        : undefined,
                      top: previewLayout
                        ? `${previewLayout.top + (previewLayout.height * (1 - FRAME_HEIGHT_RATIO)) / 2}px`
                        : undefined,
                      width: previewLayout
                        ? `${previewLayout.width * FRAME_WIDTH_RATIO}px`
                        : `${FRAME_WIDTH_RATIO * 100}%`,
                      height: previewLayout
                        ? `${previewLayout.height * FRAME_HEIGHT_RATIO}px`
                        : `${FRAME_HEIGHT_RATIO * 100}%`,
                      transform: previewLayout ? 'none' : undefined,
                    }}
                  >
                    <img
                      src={capturedPreviewUrl}
                      alt="已拍摄的证件照片"
                      className="h-full w-full object-fill"
                    />
                  </div>
                )}
                <div
                  className={`pointer-events-none absolute rounded-2xl border-[3px] border-dashed shadow-[0_0_0_9999px_rgba(15,23,42,0.38)] transition-all duration-200 ${
                    frameFeedback === 'capturing'
                      ? 'animate-pulse border-amber-100 shadow-[0_0_0_9999px_rgba(15,23,42,0.14),0_0_0_14px_rgba(252,211,77,0.82)]'
                      : frameFeedback === 'steady'
                        ? 'animate-pulse border-emerald-100 shadow-[0_0_0_9999px_rgba(15,23,42,0.16),0_0_0_14px_rgba(110,231,183,0.8)]'
                        : frameFeedback === 'success'
                          ? 'border-sky-100 shadow-[0_0_0_9999px_rgba(15,23,42,0.1),0_0_0_16px_rgba(125,211,252,0.88)]'
                          : frameFeedback === 'error'
                            ? 'animate-pulse border-rose-100 shadow-[0_0_0_9999px_rgba(15,23,42,0.18),0_0_0_14px_rgba(253,164,175,0.82)]'
                            : 'border-white'
                  }`}
                  style={{
                    left: previewLayout
                      ? `${previewLayout.left + (previewLayout.width * (1 - FRAME_WIDTH_RATIO)) / 2}px`
                      : `${((1 - FRAME_WIDTH_RATIO) / 2) * 100}%`,
                    top: previewLayout
                      ? `${previewLayout.top + (previewLayout.height * (1 - FRAME_HEIGHT_RATIO)) / 2}px`
                      : `${((1 - FRAME_HEIGHT_RATIO) / 2) * 100}%`,
                    width: previewLayout
                      ? `${previewLayout.width * FRAME_WIDTH_RATIO}px`
                      : `${FRAME_WIDTH_RATIO * 100}%`,
                    height: previewLayout
                      ? `${previewLayout.height * FRAME_HEIGHT_RATIO}px`
                      : `${FRAME_HEIGHT_RATIO * 100}%`,
                  }}
                />
                {capturedPreviewUrl && (
                  <div
                    className="pointer-events-none absolute z-10"
                    style={{
                      left: previewLayout
                        ? `${previewLayout.left + (previewLayout.width * (1 - FRAME_WIDTH_RATIO)) / 2}px`
                        : `${((1 - FRAME_WIDTH_RATIO) / 2) * 100}%`,
                      top: previewLayout
                        ? `${previewLayout.top + (previewLayout.height * (1 - FRAME_HEIGHT_RATIO)) / 2}px`
                        : `${((1 - FRAME_HEIGHT_RATIO) / 2) * 100}%`,
                      width: previewLayout
                        ? `${previewLayout.width * FRAME_WIDTH_RATIO}px`
                        : `${FRAME_WIDTH_RATIO * 100}%`,
                      height: previewLayout
                        ? `${previewLayout.height * FRAME_HEIGHT_RATIO}px`
                        : `${FRAME_HEIGHT_RATIO * 100}%`,
                    }}
                  >
                    <div className="relative h-full overflow-hidden rounded-2xl border border-cyan-200/60 bg-cyan-200/10 shadow-[0_0_42px_rgba(34,211,238,0.28)]">
                      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-cyan-300/25 to-transparent" />
                      <div className="patient-smart-scan-line absolute inset-x-3 h-1.5 rounded-full bg-cyan-200 shadow-[0_0_24px_rgba(103,232,249,1)]" />
                      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-cyan-300/20 to-transparent" />
                    </div>
                  </div>
                )}
                <div
                  className={`pointer-events-none absolute rounded-[1.1rem] transition-opacity duration-200 ${
                    frameFeedback === 'capturing'
                      ? 'animate-pulse bg-amber-200/30 opacity-100'
                      : frameFeedback === 'steady'
                        ? 'animate-pulse bg-emerald-200/28 opacity-100'
                        : 'opacity-0'
                  }`}
                  style={{
                    left: previewLayout
                      ? `${previewLayout.left + (previewLayout.width * (1 - FRAME_WIDTH_RATIO)) / 2}px`
                      : `${((1 - FRAME_WIDTH_RATIO) / 2) * 100}%`,
                    top: previewLayout
                      ? `${previewLayout.top + (previewLayout.height * (1 - FRAME_HEIGHT_RATIO)) / 2}px`
                      : `${((1 - FRAME_HEIGHT_RATIO) / 2) * 100}%`,
                    width: previewLayout
                      ? `${previewLayout.width * FRAME_WIDTH_RATIO}px`
                      : `${FRAME_WIDTH_RATIO * 100}%`,
                    height: previewLayout
                      ? `${previewLayout.height * FRAME_HEIGHT_RATIO}px`
                      : `${FRAME_HEIGHT_RATIO * 100}%`,
                  }}
                />
                {torchEnabled && (
                  <div className="pointer-events-none absolute right-4 top-4 rounded-full bg-amber-300/90 px-3 py-1 text-xs font-semibold text-slate-950 shadow-lg">
                    补光已开启
                  </div>
                )}
                {capturedPreviewUrl && (
                  <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-center px-5">
                    <div className="flex items-center gap-3 rounded-full bg-slate-950/82 px-5 py-3 text-base font-semibold text-white shadow-xl backdrop-blur">
                      <Loader2 size={18} className="animate-spin text-cyan-300" />
                      <span>照片已固定，正在扫码识别，现在可以放下手机</span>
                    </div>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
                  <div className="rounded-full bg-black/55 px-3 py-2 text-center text-sm text-white/95 backdrop-blur">
                    {cameraError || cameraHint}
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeSmartCamera}
                  className="flex-1 rounded-2xl bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    autoCapturedRef.current = true;
                    void captureSmartCameraFrame();
                  }}
                  disabled={!cameraReady || Boolean(cameraError) || isAutoCapturing || isScanning}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-gray-500"
                >
                  {isAutoCapturing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                  手动拍照
                </button>
              </div>
              <p className="text-center text-xs text-white/65">
                自动拍照不理想时，可直接点“手动拍照”
              </p>
            </div>
          </div>
          <canvas ref={smartCanvasRef} className="hidden" />
        </div>
      )}
    </>
  );
}
