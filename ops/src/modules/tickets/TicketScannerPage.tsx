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
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const lastScanAtRef = useRef(0);

  const [manualTicketId, setManualTicketId] = useState('');
  const [scannerError, setScannerError] = useState('');
  const [scannerInfo, setScannerInfo] = useState('');
  const [scannerActive, setScannerActive] = useState(false);

  const barcodeDetectorCtor = useMemo<BarcodeDetectorConstructor | null>(() => {
    const candidate = (window as any).BarcodeDetector as BarcodeDetectorConstructor | undefined;
    return candidate || null;
  }, []);
  const scannerSupported = !!barcodeDetectorCtor && !!navigator.mediaDevices?.getUserMedia;

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

  const startScanner = useCallback(async () => {
    if (!scannerSupported || !barcodeDetectorCtor) {
      setScannerError('QR-Scanner wird in diesem Browser nicht unterstützt.');
      return;
    }
    try {
      setScannerError('');
      setScannerInfo('Kamera wird gestartet…');
      stopScanner();
      detectorRef.current = new barcodeDetectorCtor({ formats: ['qr_code'] });
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
      setScannerInfo('Scanner aktiv. QR-Code ins Kamerabild halten.');
      setScannerActive(true);

      const loop = async () => {
        const detector = detectorRef.current;
        const video = videoRef.current;
        if (!detector || !video || video.readyState < 2) {
          rafRef.current = window.requestAnimationFrame(() => void loop());
          return;
        }
        try {
          const now = Date.now();
          if (now - lastScanAtRef.current >= 280) {
            lastScanAtRef.current = now;
            const detections = await detector.detect(video);
            if (Array.isArray(detections) && detections.length > 0) {
              const rawValue = normalizeText(detections[0]?.rawValue);
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
  }, [barcodeDetectorCtor, openTicket, scannerSupported, stopScanner]);

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
          Dieser Browser unterstützt keinen nativen QR-Scanner. Bitte Ticket-ID manuell eingeben.
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
                style={{ width: '100%', minHeight: 260, objectFit: 'cover' }}
              />
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<QrCodeScannerIcon />}
                onClick={() => void startScanner()}
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
