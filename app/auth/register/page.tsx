'use client';

import { useState, useEffect, FormEvent, forwardRef, useRef } from 'react';
import { signIn, getSession } from 'next-auth/react';
import DatePicker, { registerLocale, setDefaultLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import zhCN from 'date-fns/locale/zh-CN';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ScanSearch,
  ScanLine,
  Camera,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import pinyin from 'pinyin';
import { fetchWithTimeout, withTimeout } from '../../../utils/network';

const DEFAULT_PASSWORD = '123456';
const FRAME_WIDTH_RATIO = 0.96;
const FRAME_HEIGHT_RATIO = 0.84;
const AUTO_CAPTURE_REQUIRED_STABLE_FRAMES = 2;
const AUTO_CAPTURE_INTERVAL_MS = 450;
const AUTO_FOCUS_WARMUP_MS = 900;
const AUTO_CAPTURE_MIN_SHARPNESS = 6;
const AUTO_CAPTURE_MAX_MOTION = 26;
const AUTO_CAPTURE_MAX_BORDER_CLIPPING = 22;
const AUTO_CAPTURE_MAX_BORDER_EDGE_COVERAGE = 0.18;
const AUTO_TORCH_BRIGHTNESS_THRESHOLD = 72;
const AUTO_TORCH_REQUIRED_DARK_FRAMES = 3;

type ScanDocType = 'id_card' | 'medical_card' | 'auto';
type SmartFrameFeedback = 'idle' | 'steady' | 'capturing' | 'success' | 'error';

interface ScanResponse {
  name: string;
  gender: 'Male' | 'Female' | 'Other' | null;
  dateOfBirth: string | null;
  password: string;
  confirmPassword: string;
  confidence: number | null;
  detectedDocumentType: 'id_card' | 'medical_card' | 'unknown';
  notes: string;
  shouldReview: boolean;
}

interface UsernameAvailabilityResponse {
  available?: boolean;
  message?: string;
  suggestedUsername?: string;
}

interface FrameMetrics {
  motion: number;
  sharpness: number;
  brightness: number;
  borderClipping: number;
  borderEdgeCoverage: number;
}

interface PreviewLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

function scoreRearCameraDevice(device: MediaDeviceInfo): number {
  const label = device.label.toLowerCase();
  let score = 0;

  if (
    /front|user|前置|前摄|自拍|facetime/i.test(label)
  ) {
    return -1000;
  }

  if (/back|rear|environment|后置|后摄/i.test(label)) {
    score += 80;
  }

  if (/wide|main|standard|normal|广角|主摄|标准/i.test(label)) {
    score += 35;
  }

  if (/tele|telephoto|长焦|macro|微距|depth|景深|bokeh/i.test(label)) {
    score -= 45;
  }

  if (/ultra|超广/i.test(label)) {
    score -= 18;
  }

  if (/0,\s*facing\s*back|camera0|cam0/i.test(label)) {
    score += 20;
  }

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

  if (file.size <= SAFE_TARGET_BYTES) {
    return file;
  }

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

export default function RegisterPage() {
  registerLocale('zh-CN', zhCN);
  setDefaultLocale('zh-CN');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('13930555555');
  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [confirmPassword, setConfirmPassword] = useState(DEFAULT_PASSWORD);
  const [isUsernameManuallyEdited, setIsUsernameManuallyEdited] = useState(false);
  const [usernameAvailability, setUsernameAvailability] = useState<{
    status: 'idle' | 'checking' | 'available' | 'taken';
    message: string;
  }>({ status: 'idle', message: '' });
  const [debouncedUsername, setDebouncedUsername] = useState(username);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanDocType] = useState<ScanDocType>('auto');
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

  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const DateInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => (
      <input ref={ref} {...props} inputMode="numeric" className="input-base mt-2 w-full" />
    )
  );
  DateInput.displayName = 'DateInput';

  const setDOBFromInput = (raw: string) => {
    const normalized = raw
      .replace(/[年|月|日]/g, '-')
      .replace(/[./]/g, '-')
      .replace(/\s+/g, '')
      .replace(/-+/g, '-')
      .trim();
    const m = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return;
    const y = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (mm < 1 || mm > 12) return;
    const test = new Date(y, mm - 1, dd);
    if (test.getFullYear() !== y || test.getMonth() !== mm - 1 || test.getDate() !== dd) return;
    const t = new Date();
    const age = t.getFullYear() - y;
    if (age < 0 || age > 150) return;
    const pmm = String(mm).padStart(2, '0');
    const pdd = String(dd).padStart(2, '0');
    setDateOfBirth(`${y}-${pmm}-${pdd}`);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setDOBFromInput(e.target.value);
  };

  const stopSubmitting = () => {
    setSubmitting(false);
    setStage(null);
    setProgress(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetRegistrationFieldsForScan = () => {
    setName('');
    setPhone('13930555555');
    setGender('');
    setDateOfBirth('');
    setUsername('');
    setDebouncedUsername('');
    setPassword(DEFAULT_PASSWORD);
    setConfirmPassword(DEFAULT_PASSWORD);
    setIsUsernameManuallyEdited(false);
    setUsernameAvailability({ status: 'idle', message: '' });
    setError(null);
    setSuccess(null);
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
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

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
        ? (track.getCapabilities() as MediaTrackCapabilities & {
            focusMode?: string[];
          })
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
      if (!zoomCapability || typeof zoomCapability !== 'object') {
        return false;
      }

      const minZoom =
        typeof zoomCapability.min === 'number' ? zoomCapability.min : undefined;
      const maxZoom =
        typeof zoomCapability.max === 'number' ? zoomCapability.max : undefined;

      if (typeof minZoom !== 'number' || typeof maxZoom !== 'number') {
        return false;
      }

      const targetZoom =
        minZoom <= 1 && maxZoom >= 1
          ? 1
          : minZoom;

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
    if (!navigator.mediaDevices?.enumerateDevices) {
      return null;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((device) => device.kind === 'videoinput');
      if (videoInputs.length === 0) {
        return null;
      }

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

  const openScanPicker = () => {
    resetRegistrationFieldsForScan();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const uploadScanFile = async (file: File) => {
    const currentDocType = scanDocType;
    setIsScanning(true);
    setError(null);
    setSuccess(null);

    try {
      const uploadFile = await prepareImageForVercelUpload(file);
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('docType', currentDocType);

      const response = await fetchWithTimeout(
        '/api/ocr/patient-registration',
        {
          method: 'POST',
          body: formData,
        },
        45000
      );

      const data = (await response.json()) as ScanResponse | { error?: string };
      if (!response.ok) {
        throw new Error(
          'error' in data && typeof data.error === 'string'
            ? data.error
            : '证件识别失败，请重试。'
        );
      }

      const result = data as ScanResponse;

      if (result.name) {
        setIsUsernameManuallyEdited(false);
        setName(result.name);
      }
      if (result.gender) {
        setGender(result.gender);
      }
      if (result.dateOfBirth) {
        setDateOfBirth(result.dateOfBirth);
      }
      setPassword(result.password || DEFAULT_PASSWORD);
      setConfirmPassword(result.confirmPassword || result.password || DEFAULT_PASSWORD);
    } catch (err) {
      setError(err instanceof Error ? err.message : '证件识别失败，请重试。');
    } finally {
      setIsScanning(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleScanFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadScanFile(file);
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
    resetRegistrationFieldsForScan();
    setCameraError(null);
    setCameraHint('把证件放进大框里');
    setFrameFeedback('idle');
    setCapturedPreviewUrl(null);
    setPreviewLayout(null);
    setSmartCameraOpen(true);
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
        if (diff >= strongEdgeThreshold) {
          leftEdgeHits += 1;
        }
      }

      for (let x = width - borderBand; x < width; x += 1) {
        const diff = Math.abs(grayscale[y * width + x] - grayscale[y * width + x - 1]);
        borderClippingTotal += diff;
        borderClippingSamples += 1;
        rightEdgeSamples += 1;
        if (diff >= strongEdgeThreshold) {
          rightEdgeHits += 1;
        }
      }
    }

    for (let y = 0; y < borderBand; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const diff = Math.abs(
          grayscale[y * width + x] - grayscale[(y + 1) * width + x]
        );
        borderClippingTotal += diff;
        borderClippingSamples += 1;
        topEdgeSamples += 1;
        if (diff >= strongEdgeThreshold) {
          topEdgeHits += 1;
        }
      }
    }

    for (let y = height - borderBand; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const diff = Math.abs(
          grayscale[y * width + x] - grayscale[(y - 1) * width + x]
        );
        borderClippingTotal += diff;
        borderClippingSamples += 1;
        bottomEdgeSamples += 1;
        if (diff >= strongEdgeThreshold) {
          bottomEdgeHits += 1;
        }
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

    return {
      motion: motionTotal,
      sharpness: sharpnessTotal / (width * height),
      brightness: brightnessTotal / grayscale.length,
      borderClipping:
        borderClippingSamples > 0
          ? borderClippingTotal / borderClippingSamples
          : 0,
      borderEdgeCoverage: Math.max(
        leftEdgeSamples > 0 ? leftEdgeHits / leftEdgeSamples : 0,
        rightEdgeSamples > 0 ? rightEdgeHits / rightEdgeSamples : 0,
        topEdgeSamples > 0 ? topEdgeHits / topEdgeSamples : 0,
        bottomEdgeSamples > 0 ? bottomEdgeHits / bottomEdgeSamples : 0
      ),
    };
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
        err instanceof Error ? err.message : '智能扫描失败，请改用普通扫描。'
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
    if (name && !isUsernameManuallyEdited) {
      const pinyinName = pinyin(name, { style: pinyin.STYLE_NORMAL })
        .flat()
        .join('')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
      setUsername(pinyinName);
    }
  }, [name, isUsernameManuallyEdited]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedUsername(username);
    }, isUsernameManuallyEdited ? 500 : 0);

    return () => {
      clearTimeout(handler);
    };
  }, [username, isUsernameManuallyEdited]);

  useEffect(() => {
    if (debouncedUsername.length < 3) {
      setUsernameAvailability({ status: 'idle', message: '' });
      return;
    }

    const checkUsername = async () => {
      setUsernameAvailability({ status: 'checking', message: '' });
      try {
        const res = await fetchWithTimeout(
          `/api/users/availability?username=${encodeURIComponent(debouncedUsername)}`
        );
        const data = (await res.json()) as UsernameAvailabilityResponse;
        if (data.available) {
          setUsernameAvailability({
            status: 'available',
            message: data.message || '用户名可用。',
          });
        } else if (
          !isUsernameManuallyEdited &&
          typeof data.suggestedUsername === 'string' &&
          data.suggestedUsername !== debouncedUsername
        ) {
          setUsernameAvailability({
            status: 'checking',
            message: `已自动改为 ${data.suggestedUsername}，正在检查...`,
          });
          setUsername(data.suggestedUsername);
        } else {
          setUsernameAvailability({
            status: 'taken',
            message: data.message || '用户名已占用。',
          });
        }
      } catch {
        setUsernameAvailability({ status: 'taken', message: '无法检查用户名。' });
      }
    };

    checkUsername();
  }, [debouncedUsername, isUsernameManuallyEdited]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      stopSmartCameraStream();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!smartCameraOpen) return;
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('当前浏览器不支持网页内相机，请改用普通扫描。');
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

        if (
          preferredRearCameraId &&
          preferredRearCameraId !== currentDeviceId
        ) {
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
        setCameraError('无法打开相机，请检查权限，或改用普通扫描。');
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
      const isStable =
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
  }, [cameraError, cameraReady, isAutoCapturing, isScanning, smartCameraOpen]);

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    setStage('正在创建账户…');
    setProgress(8);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setProgress((p) => {
        const next = p + 4;
        return next >= 90 ? 90 : next;
      });
    }, 200);

    if (usernameAvailability.status !== 'available') {
      setError('用户名不可用');
      stopSubmitting();
      return;
    }

    if (!name || name.trim().length < 2) {
      setError('姓名至少需要2个字符');
      stopSubmitting();
      return;
    }

    if (!/^[1-9]\d{10}$/.test(phone)) {
      setError('请输入有效的11位手机号码');
      stopSubmitting();
      return;
    }

    if (!['Male', 'Female', 'Other'].includes(gender)) {
      setError('请选择有效的性别');
      stopSubmitting();
      return;
    }

    if (!dateOfBirth) {
      setError('请输入出生日期');
      stopSubmitting();
      return;
    }

    const birthDate = new Date(dateOfBirth);
    if (Number.isNaN(birthDate.getTime())) {
      setError('请输入有效的出生日期');
      stopSubmitting();
      return;
    }
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    if (age < 0 || age > 150) {
      setError('请输入有效的出生日期');
      stopSubmitting();
      return;
    }

    if (password !== confirmPassword) {
      setError('密码不匹配');
      stopSubmitting();
      return;
    }

    if (!password || password.length < 6) {
      setError('密码至少需要6个字符');
      stopSubmitting();
      return;
    }

    try {
      const response = await fetchWithTimeout(
        '/api/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            phone,
            gender,
            dateOfBirth,
            username,
            password,
          }),
        },
        20000
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '发生错误');
      }

      const finalUsername =
        typeof data.username === 'string' && data.username ? data.username : username;
      setUsername(finalUsername);
      setUsernameAvailability({ status: 'available', message: '用户名可用。' });

      setSuccess('账户创建成功！正在登录…');
      setStage('注册成功，正在登录…');
      setProgress(92);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      try {
        const loginResult = await withTimeout(
          signIn('credentials', {
            redirect: false,
            username: finalUsername,
            password,
          }),
          15000,
          '自动登录超时'
        );

        if (loginResult?.error) {
          throw new Error('自动登录失败');
        }

        setStage('正在建立会话…');
        setProgress(96);

        const session = await withTimeout(
          getSession(),
          10000,
          '获取会话超时'
        );

        setStage('正在跳转…');
        setProgress(100);

        if (session?.user?.role === 'ADMIN') {
          router.push('/admin/dashboard');
        } else if (session?.user?.role === 'DOCTOR') {
          router.push('/doctor/schedule');
        } else {
          router.push('/');
        }
      } catch (loginErr) {
        console.warn('Auto-login failed:', loginErr);
        setSuccess(null);
        setError(`账户已创建，但自动登录失败或超时，请使用用户名 ${finalUsername} 手动登录。`);
        stopSubmitting();
        setTimeout(() => router.push('/auth/signin'), 2000);
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : '发生未知错误'
      );
      stopSubmitting();
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <style jsx global>{`
        @keyframes smart-scan-line {
          0% {
            top: 0;
            opacity: 0.55;
          }
          50% {
            opacity: 1;
          }
          100% {
            top: calc(100% - 0.375rem);
            opacity: 0.75;
          }
        }

        .smart-scan-line {
          animation: smart-scan-line 1s linear infinite alternate;
        }
      `}</style>
      <div className="fixed right-3 top-1/2 z-40 -translate-y-1/2 md:right-4">
        <div className="flex flex-col gap-2 rounded-3xl border border-slate-200 bg-white/92 p-2 shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={openSmartCamera}
            disabled={isScanning || submitting}
            title="智能扫描"
            aria-label="智能扫描"
            className="flex h-14 w-14 flex-col items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {smartCameraOpen && (cameraReady || isAutoCapturing) ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <ScanLine size={18} />
            )}
            <span className="mt-1 text-[10px] font-medium leading-none">智能</span>
          </button>
          <button
            type="button"
            onClick={openScanPicker}
            disabled={isScanning || submitting}
            title="扫描身份证或社保卡"
            aria-label="扫描身份证或社保卡"
            className="flex h-14 w-14 flex-col items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isScanning ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <ScanSearch size={18} />
            )}
            <span className="mt-1 text-[10px] font-medium leading-none">扫描</span>
          </button>
        </div>
      </div>

      <div className="w-full max-w-md p-10 space-y-8 bg-white rounded-2xl shadow-xl">
        <h1 className="text-3xl font-bold text-center text-foreground">创建账户</h1>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          capture="environment"
          className="hidden"
          onChange={handleScanFileChange}
        />

        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <label htmlFor="name" className="block text-lg font-medium text-foreground">
              姓名
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setIsUsernameManuallyEdited(false);
              }}
              className="input-base mt-2"
            />
          </div>

          <div>
            <label htmlFor="username" className="block text-lg font-medium text-foreground">
              用户名 (可修改)
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setIsUsernameManuallyEdited(true);
              }}
              className="input-base mt-2"
            />
            <div className="mt-2 text-sm h-5">
              {usernameAvailability.status === 'checking' && (
                <p className="text-gray-500 flex items-center gap-1">
                  <Loader2 size={16} className="animate-spin" />
                  正在检查...
                </p>
              )}
              {usernameAvailability.status === 'available' && (
                <p className="text-success flex items-center gap-1">
                  <CheckCircle2 size={16} />
                  {usernameAvailability.message || '用户名可用'}
                </p>
              )}
              {usernameAvailability.status === 'taken' && (
                <p className="text-error flex items-center gap-1">
                  <XCircle size={16} />
                  {usernameAvailability.message || '用户名已占用'}
                </p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="gender" className="block text-lg font-medium text-foreground">
              性别
            </label>
            <select
              id="gender"
              name="gender"
              required
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="input-base mt-2"
            >
              <option value="">选择性别</option>
              <option value="Male">男</option>
              <option value="Female">女</option>
              <option value="Other">其他</option>
            </select>
          </div>

          <div>
            <label className="block text-lg font-medium text-foreground">出生日期</label>
            <DatePicker
              selected={dateOfBirth ? new Date(dateOfBirth) : null}
              onChange={(date: Date | null) => {
                if (!date) {
                  setDateOfBirth('');
                  return;
                }
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                setDateOfBirth(`${y}-${m}-${d}`);
              }}
              placeholderText="选择或直接输入 YYYY-MM-DD"
              dateFormat="yyyy-MM-dd"
              locale="zh-CN"
              showYearDropdown
              yearDropdownItemNumber={(() => {
                const t = new Date();
                return t.getFullYear() - (t.getFullYear() - 150) + 1;
              })()}
              scrollableYearDropdown
              showMonthDropdown
              withPortal
              openToDate={
                dateOfBirth
                  ? undefined
                  : (() => {
                      const t = new Date();
                      return new Date(t.getFullYear() - 60, 0, 1);
                    })()
              }
              minDate={(() => {
                const t = new Date();
                return new Date(t.getFullYear() - 150, t.getMonth(), t.getDate());
              })()}
              maxDate={new Date()}
              onBlur={handleBlur}
              customInput={<DateInput />}
              shouldCloseOnSelect
              required
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-lg font-medium text-foreground">
              电话（必填）
            </label>
            <input
              id="phone"
              name="phone"
              type="text"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input-base mt-2"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-lg font-medium text-foreground">
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-base mt-2"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-lg font-medium text-foreground"
            >
              确认密码
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input-base mt-2"
            />
          </div>

          {error && (
            <div className="p-4 text-sm text-error bg-red-100 rounded-lg">{error}</div>
          )}
          {success && (
            <div className="p-4 text-sm text-success bg-green-100 rounded-lg">
              {success}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={
                usernameAvailability.status !== 'available' || submitting || isScanning
              }
              className="w-full btn btn-primary text-lg disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              注册
            </button>
          </div>
        </form>

        {submitting && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-80 bg-white rounded-xl p-6 shadow-xl space-y-4">
              <div className="flex items-center space-x-3">
                <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <div className="text-sm text-foreground">{stage || '正在处理…'}</div>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded">
                <div
                  className="h-2 bg-primary rounded transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, progress))}%`,
                  }}
                />
              </div>
              <div className="text-xs text-gray-500 text-right">
                {Math.min(100, Math.max(0, Math.floor(progress)))}%
              </div>
            </div>
          </div>
        )}

        {smartCameraOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 px-2 py-3 sm:px-4 sm:py-6">
            <div className="mx-auto flex h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-slate-950 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
                <div>
                  <h2 className="text-lg font-semibold">智能扫描</h2>
                  <p className="text-xs text-white/70">原有普通扫描入口仍然保留</p>
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
                        <div className="smart-scan-line absolute inset-x-3 h-1.5 rounded-full bg-cyan-200 shadow-[0_0_24px_rgba(103,232,249,1)]" />
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
      </div>
    </div>
  );
}
