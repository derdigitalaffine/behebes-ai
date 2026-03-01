import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import CameraswitchIcon from '@mui/icons-material/Cameraswitch';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import jsQR from 'jsqr';
import { useNavigate } from 'react-router-dom';

type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource) => Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function resolveTicketIdFromScan(rawValue: string): string | null {
  const value = normalizeText(rawValue);
  if (!value) return null;

  const fromOpsPath = value.match(/\/ops\/tickets\/([^/?#]+)/i);
  if (fromOpsPath?.[1]) return decodeURIComponent(fromOpsPath[1]);

  const fromAnyTicketPath = value.match(/\/tickets\/([^/?#]+)/i);
  if (fromAnyTicketPath?.[1]) return decodeURIComponent(fromAnyTicketPath[1]);

  const asUrl = (() => {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  })();
  if (asUrl) {
    const byUrl = asUrl.pathname.match(/\/tickets\/([^/?#]+)/i);
    if (byUrl?.[1]) return decodeURIComponent(byUrl[1]);
  }

  if (/^[a-zA-Z0-9._:-]{4,128}$/.test(value)) {
    return value;
  }
  return null;
}

export default function TicketScannerPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const detectModeRef = useRef<'native' | 'jsqr'>('jsqr');
  const lastScanAtRef = useRef(0);

  const [manualTicketId, setManualTicketId] = useState('');
  const [scannerError, setScannerError] = useState('');
  const [scannerInfo, setScannerInfo] = useState('');
  const [scannerActive, setScannerActive] = useState(false);
  const [decodingImage, setDecodingImage] = useState(false);

  const barcodeDetectorCtor = useMemo<BarcodeDetectorConstructor | null>(() => {
    const candidate = (window as any).BarcodeDetector as BarcodeDetectorConstructor | undefined;
    return candidate || null;
  }, []);
  const supportsLiveCamera = !!navigator.mediaDevices?.getUserMedia;
  const scannerSupported = supportsLiveCamera;
  const hasNativeDetector = !!barcodeDetectorCtor;

  const stopScanner = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScannerActive(false);
  }, []);

  const openTicket = useCallback(
    (ticketId: string) => {
      const normalized = normalizeText(ticketId);
      if (!normalized) return;
      stopScanner();
      navigate(`/tickets/${encodeURIComponent(normalized)}`);
    },
    [navigate, stopScanner]
  );

  const detectWithJsQr = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;

    const targetWidth = Math.max(320, Math.min(960, sourceWidth));
    const scale = targetWidth / sourceWidth;
    const targetHeight = Math.max(240, Math.round(sourceHeight * scale));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
    const frame = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const decoded = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' });
    return normalizeText(decoded?.data);
  }, []);

  const startScanner = useCallback(async () => {
    if (!scannerSupported) {
      setScannerError('Live-Scanner wird in diesem Browser nicht unterstützt. Bitte Foto- oder manuelle Eingabe nutzen.');
      return;
    }
    if (!window.isSecureContext) {
      setScannerError('Kamera-Scanner benötigt eine sichere Verbindung (HTTPS).');
      return;
    }
    try {
      setScannerError('');
      setScannerInfo('Kamera wird gestartet…');
      stopScanner();
      if (barcodeDetectorCtor) {
        detectorRef.current = new barcodeDetectorCtor({ formats: ['qr_code'] });
        detectModeRef.current = 'native';
      } else {
        detectorRef.current = null;
        detectModeRef.current = 'jsqr';
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      if (!videoRef.current) {
        throw new Error('Kamera-Element nicht verfügbar.');
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScannerInfo(
        detectModeRef.current === 'native'
          ? 'Scanner aktiv (nativ). QR-Code ins Kamerabild halten.'
          : 'Scanner aktiv (Fallback). QR-Code ins Kamerabild halten.'
      );
      setScannerActive(true);

      const loop = async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 2) {
          rafRef.current = window.requestAnimationFrame(() => void loop());
          return;
        }
        try {
          const now = Date.now();
          if (now - lastScanAtRef.current >= 280) {
            lastScanAtRef.current = now;
            let rawValue = '';
            if (detectModeRef.current === 'native' && detectorRef.current) {
              const detections = await detectorRef.current.detect(video);
              rawValue = normalizeText(detections?.[0]?.rawValue);
            } else {
              rawValue = normalizeText(detectWithJsQr());
            }
            if (rawValue) {
              const ticketId = resolveTicketIdFromScan(rawValue);
              if (ticketId) {
                openTicket(ticketId);
                return;
              }
            }
          }
        } catch {
          // continue scanning
        }
        rafRef.current = window.requestAnimationFrame(() => void loop());
      };
      rafRef.current = window.requestAnimationFrame(() => void loop());
    } catch (error: any) {
      stopScanner();
      setScannerError(normalizeText(error?.message) || 'Kamera konnte nicht gestartet werden.');
      setScannerInfo('');
    }
  }, [barcodeDetectorCtor, detectWithJsQr, openTicket, scannerSupported, stopScanner]);

  const decodeTicketFromImageFile = useCallback(
    async (file: File) => {
      setDecodingImage(true);
      try {
        setScannerError('');
        setScannerInfo('Bild wird analysiert…');
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('Bild konnte nicht gelesen werden.'));
          reader.readAsDataURL(file);
        });

        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
          img.src = dataUrl;
        });

        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Scanner-Canvas ist nicht verfügbar.');
        const maxWidth = Math.max(480, Math.min(1200, image.naturalWidth));
        const scale = maxWidth / image.naturalWidth;
        const width = Math.max(240, Math.round(image.naturalWidth * scale));
        const height = Math.max(240, Math.round(image.naturalHeight * scale));
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas konnte nicht initialisiert werden.');
        ctx.drawImage(image, 0, 0, width, height);
        const frame = ctx.getImageData(0, 0, width, height);
        const decoded = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' });
        const rawValue = normalizeText(decoded?.data);
        const ticketId = resolveTicketIdFromScan(rawValue);
        if (!ticketId) {
          throw new Error('Kein gültiger Ticket-QR-Code im Bild gefunden.');
        }
        openTicket(ticketId);
      } catch (error: any) {
        setScannerError(normalizeText(error?.message) || 'Bild konnte nicht ausgewertet werden.');
      } finally {
        setDecodingImage(false);
        setScannerInfo((prev) => (prev === 'Bild wird analysiert…' ? '' : prev));
      }
    },
    [openTicket]
  );

  useEffect(() => () => stopScanner(), [stopScanner]);

  return (
    <Stack spacing={2.2} className="ops-page-shell">
      <Card>
        <CardContent sx={{ p: { xs: 1.8, md: 2.2 } }}>
          <Typography variant="h5">Ticket-Scanner</Typography>
          <Typography variant="body2" color="text.secondary">
            QR-Code scannen oder Ticket-ID direkt eingeben.
          </Typography>
        </CardContent>
      </Card>

      {!scannerSupported ? (
        <Alert severity="warning">
          Live-Scanner wird nicht unterstützt. Bitte Foto-Scan oder manuelle Eingabe nutzen.
        </Alert>
      ) : null}
      {scannerSupported && !hasNativeDetector ? (
        <Alert severity="info">
          Fallback aktiv: Dieser Browser nutzt den kompatiblen QR-Decoder für iOS/Safari-PWA.
        </Alert>
      ) : null}

      {scannerError ? <Alert severity="error">{scannerError}</Alert> : null}
      {scannerInfo ? <Alert severity="info">{scannerInfo}</Alert> : null}

      <Card>
        <CardContent>
          <Stack spacing={1.2}>
            <Typography variant="h6" fontWeight={700}>Kamera</Typography>
            <Box
              sx={{
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid #d1d5db',
                bgcolor: '#0f172a',
                minHeight: 260,
              }}
            >
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                style={{ width: '100%', minHeight: 260, objectFit: 'cover' }}
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<QrCodeScannerIcon />}
                onClick={() => void startScanner()}
                disabled={!scannerSupported}
              >
                Scanner starten
              </Button>
              <Button
                variant="outlined"
                startIcon={<CameraswitchIcon />}
                onClick={stopScanner}
                disabled={!scannerActive}
              >
                Scanner stoppen
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1.2}>
            <Typography variant="h6" fontWeight={700}>Notfall-Fallback (Foto)</Typography>
            <Typography variant="body2" color="text.secondary">
              Foto aus Kamera oder Galerie auswählen und QR-Code auslesen.
            </Typography>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void decodeTicketFromImageFile(file);
                event.currentTarget.value = '';
              }}
            />
            <Button
              variant="outlined"
              startIcon={<PhotoCameraIcon />}
              onClick={() => fileInputRef.current?.click()}
              disabled={decodingImage}
            >
              {decodingImage ? 'Bild wird geprüft…' : 'Foto auswählen / aufnehmen'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1.2}>
            <Typography variant="h6" fontWeight={700}>Manuelle Eingabe</Typography>
            <TextField
              label="Ticket-ID oder Ticket-URL"
              value={manualTicketId}
              onChange={(event) => setManualTicketId(event.target.value)}
              placeholder="z. B. TICKET_123456"
              size="small"
            />
            <Button
              variant="outlined"
              onClick={() => {
                const ticketId = resolveTicketIdFromScan(manualTicketId);
                if (!ticketId) {
                  setScannerError('Ungültige Ticket-ID oder URL.');
                  return;
                }
                setScannerError('');
                openTicket(ticketId);
              }}
            >
              Ticket öffnen
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
