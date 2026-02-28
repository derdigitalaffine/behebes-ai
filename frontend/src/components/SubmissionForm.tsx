import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import AddressSearch from './AddressSearch';
import LocationMap from './LocationMap';
import {
  FormField,
  Alert,
  ActionButton,
  ProgressBar,
  SummaryItem,
} from './FormComponents';
import { useI18n } from '../i18n/I18nProvider';
import { extractExifGpsFromFile } from '../utils/exifGps';
import { getCitizenSession } from '../lib/citizenAuth';

interface FormData {
  name: string;
  email: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
  postalCode: string;
  city: string;
}

type LocationSource = 'gps' | 'ip' | 'manual' | 'address' | 'exif' | null;

type LocationSelection = {
  latitude: number;
  longitude: number;
  address: string;
  postalCode?: string;
  city?: string;
  source?: Exclude<LocationSource, null>;
};

interface UploadedImage {
  id: string;
  name: string;
  size: number;
  file: File;
  previewUrl: string;
  isImage: boolean;
  exifStatus: 'pending' | 'found' | 'none';
  exifGps: {
    latitude: number;
    longitude: number;
  } | null;
}

type FormStep = 'input' | 'preview';

type SuccessModalState = {
  open: boolean;
  message: string;
  ticketId: string;
};

const INITIAL_SUCCESS_MODAL: SuccessModalState = {
  open: false,
  message: '',
  ticketId: '',
};

const IMAGE_FILE_NAME_PATTERN = /\.(avif|bmp|gif|heic|heif|jpeg|jpg|png|tif|tiff|webp)$/i;
const CLIENT_IMAGE_OPTIMIZE_MAX_DIMENSION = 2560;
const CLIENT_IMAGE_SOFT_TARGET_BYTES = 6 * 1024 * 1024;
const CLIENT_IMAGE_QUALITY_STEPS = [0.86, 0.8, 0.74, 0.68, 0.62, 0.56];
const CLIENT_IMAGE_MIME_CANDIDATES = ['image/webp', 'image/jpeg'] as const;
const EXIF_PARSE_MAX_BYTES = 16 * 1024 * 1024;
const EXIF_SUPPORTED_FILE_NAME_PATTERN = /\.(jpeg|jpg|tif|tiff|webp)$/i;
const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

function fileLooksLikeImage(file: File): boolean {
  const mimeType = String(file?.type || '').trim();
  if (mimeType.toLowerCase().startsWith('image/')) return true;
  return IMAGE_FILE_NAME_PATTERN.test(String(file?.name || '').toLowerCase());
}

function sanitizeImageFileName(fileName: string): string {
  const normalized = String(fileName || '').trim();
  return normalized || 'bild';
}

function replaceFileExtension(fileName: string, extension: string): string {
  const safeName = sanitizeImageFileName(fileName);
  const baseName = safeName.replace(/\.[a-z0-9]+$/i, '').trim() || 'bild';
  return `${baseName}.${extension}`;
}

function inferImageMimeFromFileName(fileName: string): string | null {
  const lowered = String(fileName || '').toLowerCase();
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) return 'image/jpeg';
  if (lowered.endsWith('.png')) return 'image/png';
  if (lowered.endsWith('.gif')) return 'image/gif';
  if (lowered.endsWith('.webp')) return 'image/webp';
  if (lowered.endsWith('.bmp')) return 'image/bmp';
  if (lowered.endsWith('.tif') || lowered.endsWith('.tiff')) return 'image/tiff';
  if (lowered.endsWith('.avif')) return 'image/avif';
  if (lowered.endsWith('.heic')) return 'image/heic';
  if (lowered.endsWith('.heif')) return 'image/heif';
  return null;
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.length) return '';
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

async function sniffImageMimeType(file: File): Promise<string | null> {
  if (!(file instanceof File)) return null;
  try {
    const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      header.length >= 8 &&
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47 &&
      header[4] === 0x0d &&
      header[5] === 0x0a &&
      header[6] === 0x1a &&
      header[7] === 0x0a
    ) {
      return 'image/png';
    }
    if (header.length >= 6 && (readFourCC(header, 0) === 'GIF8')) {
      return 'image/gif';
    }
    if (header.length >= 12 && readFourCC(header, 0) === 'RIFF' && readFourCC(header, 8) === 'WEBP') {
      return 'image/webp';
    }
    if (header.length >= 2 && header[0] === 0x42 && header[1] === 0x4d) {
      return 'image/bmp';
    }
    if (
      header.length >= 4 &&
      ((header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2a && header[3] === 0x00) ||
        (header[0] === 0x4d && header[1] === 0x4d && header[2] === 0x00 && header[3] === 0x2a))
    ) {
      return 'image/tiff';
    }

    if (header.length >= 12 && readFourCC(header, 4) === 'ftyp') {
      const brandCandidates = [
        readFourCC(header, 8).toLowerCase(),
        readFourCC(header, 16).toLowerCase(),
        readFourCC(header, 20).toLowerCase(),
        readFourCC(header, 24).toLowerCase(),
      ].filter(Boolean);

      if (brandCandidates.some((brand) => brand === 'avif' || brand === 'avis')) {
        return 'image/avif';
      }
      if (
        brandCandidates.some((brand) =>
          ['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'].includes(brand)
        )
      ) {
        return 'image/heic';
      }
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeImageFileForUpload(file: File, detectedMime: string | null): File {
  if (!(file instanceof File)) return file;
  const currentMime = String(file.type || '').trim().toLowerCase();
  const imageMime = detectedMime || inferImageMimeFromFileName(file.name) || null;
  const effectiveMime = imageMime || currentMime;
  const extension = IMAGE_MIME_TO_EXTENSION[effectiveMime] || null;
  const normalizedName = extension
    ? replaceFileExtension(sanitizeImageFileName(file.name), extension)
    : sanitizeImageFileName(file.name);

  if (effectiveMime && normalizedName !== file.name) {
    return new File([file], normalizedName, {
      type: effectiveMime,
      lastModified: file.lastModified || Date.now(),
    });
  }
  if (!currentMime && effectiveMime) {
    return new File([file], normalizedName, {
      type: effectiveMime,
      lastModified: file.lastModified || Date.now(),
    });
  }
  return file;
}

async function normalizeIncomingUploadFile(file: File): Promise<{ file: File; isImage: boolean } | null> {
  if (!(file instanceof File)) return null;
  if (fileLooksLikeImage(file)) {
    const preferredMime = String(file.type || '').trim().toLowerCase() || inferImageMimeFromFileName(file.name);
    return {
      file: normalizeImageFileForUpload(file, preferredMime || null),
      isImage: true,
    };
  }
  const sniffedMime = await sniffImageMimeType(file);
  if (!sniffedMime) {
    return {
      file,
      isImage: false,
    };
  }
  return {
    file: normalizeImageFileForUpload(file, sniffedMime),
    isImage: true,
  };
}

function shouldAttemptExifExtraction(file: File): boolean {
  if (!(file instanceof File)) return false;
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > EXIF_PARSE_MAX_BYTES) return false;
  const mimeType = String(file.type || '').trim().toLowerCase();
  if (mimeType.includes('jpeg') || mimeType.includes('tiff') || mimeType.includes('webp')) return true;
  return EXIF_SUPPORTED_FILE_NAME_PATTERN.test(String(file.name || '').toLowerCase());
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => resolve(blob),
        mimeType,
        quality
      );
    } catch {
      resolve(null);
    }
  });
}

async function optimizeImageFileForUpload(
  file: File,
  options?: {
    maxBytes?: number;
    softTargetBytes?: number;
    maxDimension?: number;
  }
): Promise<File> {
  if (!(file instanceof File)) return file;
  if (!fileLooksLikeImage(file)) return file;
  if (typeof window === 'undefined' || typeof document === 'undefined') return file;

  const maxBytes = Math.max(1024 * 1024, Number(options?.maxBytes || file.size));
  const softTargetBytes = Math.max(
    1024 * 512,
    Math.min(maxBytes, Number(options?.softTargetBytes || CLIENT_IMAGE_SOFT_TARGET_BYTES))
  );
  const maxDimension = Math.max(800, Number(options?.maxDimension || CLIENT_IMAGE_OPTIMIZE_MAX_DIMENSION));
  const shouldOptimize = file.size > softTargetBytes;
  if (!shouldOptimize) return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const imageElement = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image_load_failed'));
      image.src = objectUrl;
    });

    const sourceWidth = Math.max(1, Number(imageElement.naturalWidth || imageElement.width || 1));
    const sourceHeight = Math.max(1, Number(imageElement.naturalHeight || imageElement.height || 1));
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(imageElement, 0, 0, targetWidth, targetHeight);

    let bestBlob: Blob | null = null;
    let bestMime: string = file.type || 'image/jpeg';

    for (const mimeType of CLIENT_IMAGE_MIME_CANDIDATES) {
      for (const quality of CLIENT_IMAGE_QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, mimeType, quality);
        if (!blob || blob.size <= 0) continue;
        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
          bestMime = mimeType;
        }
        if (blob.size <= softTargetBytes) {
          const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
          const optimizedName = replaceFileExtension(file.name, extension);
          return new File([blob], optimizedName, {
            type: mimeType,
            lastModified: Date.now(),
          });
        }
      }
    }

    if (bestBlob && bestBlob.size <= maxBytes && bestBlob.size < file.size) {
      const extension = bestMime === 'image/webp' ? 'webp' : 'jpg';
      const optimizedName = replaceFileExtension(file.name, extension);
      return new File([bestBlob], optimizedName, {
        type: bestMime,
        lastModified: Date.now(),
      });
    }

    return file;
  } catch {
    return file;
  } finally {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // ignore
    }
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });
}

const SubmissionForm: React.FC = () => {
  const MAX_IMAGE_SIZE_MB = 25;
  const MAX_IMAGE_SIZE = MAX_IMAGE_SIZE_MB * 1024 * 1024;
  const MAX_IMAGES = 5;
  const {
    t,
    language,
    frontendToken,
    citizenAuthEnabled,
    citizenProfileTexts,
    languages,
    maintenanceMode,
    maintenanceMessage,
    restrictLocations,
    allowedLocations,
    jurisdictionGeofence,
  } = useI18n();
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    description: '',
    latitude: null,
    longitude: null,
    address: '',
    postalCode: '',
    city: '',
  });

  const [step, setStep] = useState<FormStep>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successModal, setSuccessModal] = useState<SuccessModalState>(INITIAL_SUCCESS_MODAL);
  const [mapUpdate, setMapUpdate] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [imageError, setImageError] = useState('');
  const [isDragActive, setIsDragActive] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [warningModalMessage, setWarningModalMessage] = useState('');
  const [warningModalVariant, setWarningModalVariant] = useState<'form' | 'location'>('form');
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [locationSource, setLocationSource] = useState<LocationSource>(null);
  const [showNoLocationConfirm, setShowNoLocationConfirm] = useState(false);
  const [addressAutocompleteEnabled, setAddressAutocompleteEnabled] = useState(false);
  const [citizenAuthenticated, setCitizenAuthenticated] = useState(false);
  const [citizenSessionEmail, setCitizenSessionEmail] = useState('');
  const [checkingExifLocation, setCheckingExifLocation] = useState(false);
  const [applyingExifImageId, setApplyingExifImageId] = useState<string | null>(null);
  const [exifPromptImageId, setExifPromptImageId] = useState<string | null>(null);
  const [exifPromptSuppressed, setExifPromptSuppressed] = useState(false);
  const [hasShownExifPrompt, setHasShownExifPrompt] = useState(false);
  const [addressSearchResetKey, setAddressSearchResetKey] = useState(0);
  const imagesRef = useRef<UploadedImage[]>([]);
  const formCardRef = useRef<HTMLElement | null>(null);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const revokeImagePreview = (previewUrl: string) => {
    if (!previewUrl) return;
    try {
      URL.revokeObjectURL(previewUrl);
    } catch {
      // ignore
    }
  };

  const clearAllImagePreviews = () => {
    imagesRef.current.forEach((image) => revokeImagePreview(image.previewUrl));
  };

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    if (!exifPromptImageId) return;
    if (!images.some((image) => image.id === exifPromptImageId)) {
      setExifPromptImageId(null);
    }
  }, [images, exifPromptImageId]);

  useEffect(() => {
    return () => {
      clearAllImagePreviews();
    };
  }, []);

  useEffect(() => {
    if (step !== 'preview') return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';
    formCardRef.current?.scrollTo({ top: 0, behavior });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior });
    }
  }, [step]);

  useEffect(() => {
    let alive = true;
    const loadSession = async () => {
      try {
        const session = await getCitizenSession(frontendToken);
        if (!alive) return;
        const authenticated = session.authenticated === true;
        const sessionEmail = authenticated ? String(session.email || '').trim() : '';
        setCitizenAuthenticated(authenticated);
        setCitizenSessionEmail(sessionEmail);
        if (authenticated && sessionEmail) {
          setFormData((prev) => ({ ...prev, email: sessionEmail }));
        }
      } catch {
        if (!alive) return;
        setCitizenAuthenticated(false);
        setCitizenSessionEmail('');
      }
    };

    void loadSession();
    const intervalId = window.setInterval(() => {
      void loadSession();
    }, 30000);
    window.addEventListener('focus', loadSession);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', loadSession);
    };
  }, [frontendToken]);

  const addImages = async (fileList: FileList | File[]) => {
    setImageError('');
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const remainingSlots = MAX_IMAGES - images.length;
    if (remainingSlots <= 0) {
      setImageError(t('upload_error_max', { max: MAX_IMAGES }));
      return;
    }

    const acceptedFiles: Array<{ file: File; isImage: boolean }> = [];
    const errors: string[] = [];

    for (const file of files) {
      const normalizedFile = await normalizeIncomingUploadFile(file);
      if (!normalizedFile) {
        errors.push(t('upload_error_read'));
        continue;
      }

      const optimizedFile = normalizedFile.isImage
        ? await optimizeImageFileForUpload(normalizedFile.file, {
            maxBytes: MAX_IMAGE_SIZE,
            softTargetBytes: Math.min(MAX_IMAGE_SIZE, CLIENT_IMAGE_SOFT_TARGET_BYTES),
            maxDimension: CLIENT_IMAGE_OPTIMIZE_MAX_DIMENSION,
          })
        : normalizedFile.file;

      if (optimizedFile.size > MAX_IMAGE_SIZE) {
        errors.push(t('upload_error_too_large', { file: file.name, size: MAX_IMAGE_SIZE_MB }));
        continue;
      }
      acceptedFiles.push({
        file: optimizedFile,
        isImage: normalizedFile.isImage,
      });
      if (acceptedFiles.length >= remainingSlots) break;
    }

    if (errors.length > 0) {
      setImageError(errors.join(' '));
    }

    if (acceptedFiles.length === 0) return;

    const newImages: UploadedImage[] = acceptedFiles.map((entry) => ({
      id: `${entry.file.name}-${entry.file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: entry.file.name,
      size: entry.file.size,
      file: entry.file,
      previewUrl: entry.isImage ? URL.createObjectURL(entry.file) : '',
      isImage: entry.isImage,
      exifStatus: entry.isImage ? 'pending' : 'none',
      exifGps: null,
    }));
    setImages((prev) => [...prev, ...newImages]);

    const exifCandidates = newImages.filter((entry) => entry.isImage);
    if (exifCandidates.length === 0) return;

    setCheckingExifLocation(true);
    try {
      let firstDetectedImageId: string | null = null;
      for (const image of exifCandidates) {
        if (!shouldAttemptExifExtraction(image.file)) {
          setImages((prev) =>
            prev.map((entry) => (entry.id === image.id ? { ...entry, exifStatus: 'none', exifGps: null } : entry))
          );
          continue;
        }
        const gps = await extractExifGpsFromFile(image.file);
        if (gps) {
          setImages((prev) =>
            prev.map((entry) =>
              entry.id === image.id
                ? {
                    ...entry,
                    exifStatus: 'found',
                    exifGps: { latitude: gps.latitude, longitude: gps.longitude },
                  }
                : entry
            )
          );
          if (!firstDetectedImageId) firstDetectedImageId = image.id;
        } else {
          setImages((prev) =>
            prev.map((entry) => (entry.id === image.id ? { ...entry, exifStatus: 'none', exifGps: null } : entry))
          );
        }
      }

      if (firstDetectedImageId && !exifPromptSuppressed && !hasShownExifPrompt) {
        setHasShownExifPrompt(true);
        setExifPromptImageId((current) => current || firstDetectedImageId);
      }
    } finally {
      setCheckingExifLocation(false);
    }
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await addImages(e.target.files);
      e.target.value = '';
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
    if (e.dataTransfer.files) {
      await addImages(e.dataTransfer.files);
    }
  };

  const removeImage = (id: string) => {
    if (applyingExifImageId === id) {
      setApplyingExifImageId(null);
    }
    if (exifPromptImageId === id) {
      setExifPromptImageId(null);
    }
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) revokeImagePreview(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  };

  const normalizeLocationText = (...parts: Array<string | undefined | null>) =>
    parts
      .map((part) => (part || '').trim().toLowerCase())
      .filter(Boolean)
      .join(' ');

  const haversineDistanceMeters = (latA: number, lonA: number, latB: number, lonB: number) => {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRad(latB - latA);
    const dLon = toRad(lonB - lonA);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
  };

  const isPointInPolygon = (
    lat: number,
    lon: number,
    points: Array<{ lat: number; lon: number }>
  ) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const yi = points[i].lat;
      const xi = points[i].lon;
      const yj = points[j].lat;
      const xj = points[j].lon;
      const intersects =
        yi > lat !== yj > lat &&
        lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  };

  const evaluateJurisdictionGeofence = (location: {
    latitude?: number | null;
    longitude?: number | null;
  }): boolean | null => {
    if (!jurisdictionGeofence?.enabled) return null;
    if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return null;
    const lat = Number(location.latitude);
    const lon = Number(location.longitude);

    if (jurisdictionGeofence.shape === 'polygon') {
      const points = Array.isArray(jurisdictionGeofence.points) ? jurisdictionGeofence.points : [];
      if (points.length < 3) return null;
      return isPointInPolygon(lat, lon, points);
    }

    if (!Number.isFinite(jurisdictionGeofence.centerLat) || !Number.isFinite(jurisdictionGeofence.centerLon)) {
      return null;
    }
    const radiusMeters = Number.isFinite(jurisdictionGeofence.radiusMeters)
      ? Math.max(1, Number(jurisdictionGeofence.radiusMeters))
      : 5000;
    const distance = haversineDistanceMeters(
      lat,
      lon,
      Number(jurisdictionGeofence.centerLat),
      Number(jurisdictionGeofence.centerLon)
    );
    return distance <= radiusMeters;
  };

  const isLocationWithinScope = (location: {
    address?: string;
    city?: string;
    postalCode?: string;
    latitude?: number | null;
    longitude?: number | null;
  }): boolean => {
    if (!restrictLocations) return true;

    const normalizedAllowed = (allowedLocations || [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    const blob = normalizeLocationText(location.address, location.postalCode, location.city);
    const matchesAllowed =
      normalizedAllowed.length > 0 &&
      !!blob &&
      normalizedAllowed.some((allowed) => blob.includes(allowed));

    const geofenceResult = evaluateJurisdictionGeofence(location);
    if (geofenceResult === true) return true;
    // Fallback auf Ortslisten-Match, falls Geofence knapp daneben liegt.
    if (matchesAllowed) return true;
    if (geofenceResult === false) return false;
    return matchesAllowed;
  };

  const clearLocationFields = (options: { resetAddressInput?: boolean } = {}) => {
    setFormData((prev) => ({
      ...prev,
      latitude: null,
      longitude: null,
      address: '',
      postalCode: '',
      city: '',
    }));
    setMapUpdate(null);
    setLocationSource(null);
    setAddressAutocompleteEnabled(false);
    if (options.resetAddressInput) {
      setAddressSearchResetKey((prev) => prev + 1);
    }
  };

  const applyLocationSelection = (location: LocationSelection, options: { syncMap?: boolean } = {}) => {
    const syncMap = options.syncMap !== false;
    if (!isLocationWithinScope(location)) {
      clearLocationFields({ resetAddressInput: true });
      setWarningModalVariant('location');
      setWarningModalMessage(t('outside_jurisdiction_message'));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      latitude: location.latitude,
      longitude: location.longitude,
      address: location.address || prev.address,
      postalCode: location.postalCode ?? prev.postalCode,
      city: location.city ?? prev.city,
    }));
    setLocationSource(location.source || 'manual');
    setAddressAutocompleteEnabled(false);
    if (syncMap) {
      setMapUpdate({ latitude: location.latitude, longitude: location.longitude });
    }
  };

  const resolveAddressFromCoordinates = async (
    latitude: number,
    longitude: number
  ): Promise<{ address: string; postalCode: string; city: string }> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
      );
      const data = await response.json();
      const addressData = data?.address || {};
      const address = [
        addressData.road,
        addressData.house_number,
        addressData.postcode,
        addressData.city || addressData.town || addressData.village,
      ]
        .filter(Boolean)
        .join(' ');
      return {
        address: address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        postalCode: addressData.postcode || '',
        city: addressData.city || addressData.town || addressData.village || '',
      };
    } catch {
      return {
        address: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        postalCode: '',
        city: '',
      };
    }
  };

  const getCurrentPosition = (options: PositionOptions): Promise<GeolocationPosition> =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });

  const getBrowserCoordinates = async (): Promise<{ latitude: number; longitude: number }> => {
    if (!navigator.geolocation) {
      throw new Error('not_supported');
    }

    try {
      const first = await getCurrentPosition({
        timeout: 10000,
        enableHighAccuracy: true,
        maximumAge: 0,
      });
      return {
        latitude: first.coords.latitude,
        longitude: first.coords.longitude,
      };
    } catch (error) {
      const geoError = error as GeolocationPositionError;
      if (geoError?.code === 2 || geoError?.code === 3) {
        const second = await getCurrentPosition({
          timeout: 20000,
          enableHighAccuracy: false,
          maximumAge: 300000,
        });
        return {
          latitude: second.coords.latitude,
          longitude: second.coords.longitude,
        };
      }
      throw geoError;
    }
  };

  const getApproximateCoordinatesFromIp = async (): Promise<{ latitude: number; longitude: number } | null> => {
    try {
      const ipApi = await fetch('https://ipapi.co/json/');
      if (ipApi.ok) {
        const data = await ipApi.json();
        const latitude = Number(data?.latitude);
        const longitude = Number(data?.longitude);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          return { latitude, longitude };
        }
      }
    } catch {
      // continue with second provider
    }

    try {
      const ipWho = await fetch('https://ipwho.is/');
      if (ipWho.ok) {
        const data = await ipWho.json();
        const latitude = Number(data?.latitude);
        const longitude = Number(data?.longitude);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          return { latitude, longitude };
        }
      }
    } catch {
      // no-op
    }

    try {
      const ipInfo = await fetch('https://ipinfo.io/json');
      if (ipInfo.ok) {
        const data = await ipInfo.json();
        const rawLoc = typeof data?.loc === 'string' ? data.loc : '';
        const [latRaw, lonRaw] = rawLoc.split(',');
        const latitude = Number(latRaw);
        const longitude = Number(lonRaw);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          return { latitude, longitude };
        }
      }
    } catch {
      // no-op
    }

    return null;
  };

  const handleDetectLocation = async () => {
    setError('');
    setDetectingLocation(true);
    try {
      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        const approximate = await getApproximateCoordinatesFromIp();
        if (approximate) {
          const resolved = await resolveAddressFromCoordinates(approximate.latitude, approximate.longitude);
          applyLocationSelection({
            latitude: approximate.latitude,
            longitude: approximate.longitude,
            address: resolved.address,
            postalCode: resolved.postalCode,
            city: resolved.city,
            source: 'ip',
          });
          setError(t('geo_info_approximate_location'));
          return;
        }
        setError(t('geo_error_https'));
        return;
      }

      const { latitude, longitude } = await getBrowserCoordinates();
      const resolved = await resolveAddressFromCoordinates(latitude, longitude);
      applyLocationSelection({
        latitude,
        longitude,
        address: resolved.address,
        postalCode: resolved.postalCode,
        city: resolved.city,
        source: 'gps',
      });
    } catch (geoError) {
      const err = geoError as GeolocationPositionError;
      const approximate = await getApproximateCoordinatesFromIp();
      if (approximate) {
        const resolved = await resolveAddressFromCoordinates(approximate.latitude, approximate.longitude);
        applyLocationSelection({
          latitude: approximate.latitude,
          longitude: approximate.longitude,
          address: resolved.address,
          postalCode: resolved.postalCode,
          city: resolved.city,
          source: 'ip',
        });
        setError(t('geo_info_approximate_location'));
        return;
      }
      if (err?.code === 1) {
        setError(t('geo_error_permission_full'));
      } else if (err?.code === 2 || err?.code === 3) {
        setError(t('geo_error_fallback_full'));
      } else if ((geoError as Error)?.message === 'not_supported') {
        setError(t('geo_error_not_supported'));
      } else {
        setError(t('geo_error_simple'));
      }
    } finally {
      setDetectingLocation(false);
    }
  };

  const handleLocationChange = (location: LocationSelection) => {
    applyLocationSelection(location, { syncMap: false });
  };

  const handleAddressSelect = (location: {
    address: string;
    city: string;
    postalCode: string;
    latitude: number;
    longitude: number;
  }) => {
    applyLocationSelection({
      latitude: location.latitude,
      longitude: location.longitude,
      address: location.address,
      city: location.city,
      postalCode: location.postalCode,
      source: 'address',
    });
  };

  const handleApplyImageExifLocation = async (image: UploadedImage) => {
    if (!image.exifGps || applyingExifImageId) return;
    setApplyingExifImageId(image.id);
    try {
      const resolved = await resolveAddressFromCoordinates(
        image.exifGps.latitude,
        image.exifGps.longitude
      );
      applyLocationSelection({
        latitude: image.exifGps.latitude,
        longitude: image.exifGps.longitude,
        address: resolved.address,
        postalCode: resolved.postalCode,
        city: resolved.city,
        source: 'exif',
      });
      if (exifPromptImageId === image.id) {
        setExifPromptImageId(null);
      }
    } finally {
      setApplyingExifImageId(null);
    }
  };

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setConsentError('');

    if (
      !formData.name.trim() ||
      !formData.email.trim() ||
      !formData.description.trim()
    ) {
      setError(t('error_required_fields'));
      return;
    }
    if (!consent) {
      const message = t('error_consent_required');
      setConsentError(message);
      setError(message);
      return;
    }
    if (!formData.address.trim() && !Number.isFinite(formData.latitude) && !Number.isFinite(formData.longitude)) {
      setShowNoLocationConfirm(true);
      return;
    }
    if (locationSource === 'ip') {
      const proceed = window.confirm(t('location_ip_confirm_message'));
      if (!proceed) return;
    }
    setStep('preview');
  };

  const submitWithRetry = async (payload: FormData) => {
    const maxAttempts = 2;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await axios.post('/api/submissions', payload, {
          timeout: 120000,
        });
      } catch (error) {
        lastError = error;
        const status = Number((error as any)?.response?.status || 0);
        const isTransient =
          status === 0 ||
          status === 408 ||
          status === 425 ||
          status === 429 ||
          status === 500 ||
          status === 502 ||
          status === 503 ||
          status === 504;
        if (!isTransient || attempt >= maxAttempts) {
          throw error;
        }
        await sleepMs(500 * attempt);
      }
    }

    throw lastError;
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setConsentError('');
    if (!consent) {
      const message = t('error_consent_required');
      setConsentError(message);
      setError(message);
      setLoading(false);
      setStep('input');
      return;
    }

    try {
      const languageOption = languages.find((lang) => lang.code === language);
      const buildPayload = (includeImages: boolean) => {
        const payload = new FormData();
        payload.append('name', formData.name);
        payload.append('email', formData.email);
        payload.append('issueType', '');
        payload.append('description', formData.description);
        payload.append('address', formData.address);
        payload.append('postalCode', formData.postalCode);
        payload.append('city', formData.city);
        payload.append('language', language);
        payload.append('languageName', languageOption?.aiName || languageOption?.label || language);
        if (frontendToken) {
          payload.append('frontendToken', frontendToken);
        }
        if (Number.isFinite(formData.latitude)) {
          payload.append('latitude', String(formData.latitude));
        }
        if (Number.isFinite(formData.longitude)) {
          payload.append('longitude', String(formData.longitude));
        }
        if (includeImages) {
          images.forEach((image) => {
            payload.append('images', image.file, image.name);
          });
        }
        return payload;
      };

      const response = await submitWithRetry(buildPayload(true));
      const nextTicketId = String(response.data?.ticketId || '');
      const imageUploadFallbackUsed = response?.data?.imageUploadFallbackUsed === true;
      resetForm();
      setSuccessModal({
        open: true,
        message: imageUploadFallbackUsed
          ? t('success_submit_message_images_skipped')
          : t('success_submit_message'),
        ticketId: nextTicketId,
      });
    } catch (originalErr: any) {
      let err = originalErr;
      const firstStatus = Number(originalErr?.response?.status || 0);
      const firstCode = String(originalErr?.response?.data?.code || '').trim().toUpperCase();
      const shouldRetryWithoutImages =
        images.length > 0 &&
        (firstStatus === 0 ||
          firstStatus === 408 ||
          firstStatus === 413 ||
          firstStatus === 415 ||
          firstStatus === 422 ||
          firstStatus >= 500 ||
          firstCode === 'UPLOAD_FILE_TOO_LARGE' ||
          firstCode === 'UPLOAD_TOO_MANY_FILES' ||
          firstCode === 'UPLOAD_UNEXPECTED_FILE_FIELD' ||
          firstCode === 'UPLOAD_INVALID_FILE' ||
          firstCode === 'UPLOAD_PART_LIMIT_REACHED' ||
          firstCode === 'UPLOAD_IMAGE_UNSUPPORTED' ||
          firstCode === 'UPLOAD_FAILED');

      if (shouldRetryWithoutImages) {
        try {
          const languageOption = languages.find((lang) => lang.code === language);
          const fallbackPayload = new FormData();
          fallbackPayload.append('name', formData.name);
          fallbackPayload.append('email', formData.email);
          fallbackPayload.append('issueType', '');
          fallbackPayload.append('description', formData.description);
          fallbackPayload.append('address', formData.address);
          fallbackPayload.append('postalCode', formData.postalCode);
          fallbackPayload.append('city', formData.city);
          fallbackPayload.append('language', language);
          fallbackPayload.append('languageName', languageOption?.aiName || languageOption?.label || language);
          if (frontendToken) {
            fallbackPayload.append('frontendToken', frontendToken);
          }
          if (Number.isFinite(formData.latitude)) {
            fallbackPayload.append('latitude', String(formData.latitude));
          }
          if (Number.isFinite(formData.longitude)) {
            fallbackPayload.append('longitude', String(formData.longitude));
          }

          const fallbackResponse = await submitWithRetry(fallbackPayload);
          const nextTicketId = String(fallbackResponse.data?.ticketId || '');
          resetForm();
          setSuccessModal({
            open: true,
            message: t('success_submit_message_images_skipped'),
            ticketId: nextTicketId,
          });
          return;
        } catch (retryError: any) {
          err = retryError;
        }
      }

      const responseStatus = Number(err?.response?.status || 0);
      if (responseStatus === 413) {
        setError(t('error_submit_payload_too_large', { max: MAX_IMAGES, size: MAX_IMAGE_SIZE_MB }));
        setStep('input');
        return;
      }
      const responseCode = err?.response?.data?.code;
      const responseMessage = err?.response?.data?.message || t('error_submit_failed');
      if (
        responseCode === 'OUTSIDE_JURISDICTION' ||
        String(responseMessage).toLowerCase().includes('zuständigkeitsgebiet')
      ) {
        resetForm();
        setWarningModalVariant('form');
        setWarningModalMessage(responseMessage);
        return;
      }
      setError(responseMessage);
      setStep('input');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      email: citizenAuthenticated ? citizenSessionEmail : '',
      description: '',
      latitude: null,
      longitude: null,
      address: '',
      postalCode: '',
      city: '',
    });
    setError('');
    setStep('input');
    setImages((prev) => {
      prev.forEach((image) => revokeImagePreview(image.previewUrl));
      return [];
    });
    setImageError('');
    setShowMap(false);
    setConsent(false);
    setConsentError('');
    setShowNoLocationConfirm(false);
    setAddressAutocompleteEnabled(false);
    setCheckingExifLocation(false);
    setApplyingExifImageId(null);
    setExifPromptImageId(null);
    setExifPromptSuppressed(false);
    setHasShownExifPrompt(false);
    setSuccessModal(INITIAL_SUCCESS_MODAL);
  };

  const addressSummary =
    formData.address || [formData.postalCode, formData.city].filter(Boolean).join(' ') || '–';
  const exifImageCount = images.filter((image) => image.exifStatus === 'found').length;
  const exifPendingCount = images.filter((image) => image.exifStatus === 'pending').length;
  const exifPromptImage =
    exifPromptImageId && images.length > 0 ? images.find((image) => image.id === exifPromptImageId) || null : null;
  const geofenceState = evaluateJurisdictionGeofence({
    latitude: formData.latitude,
    longitude: formData.longitude,
  });
  const locationQualityLabel =
    locationSource === 'gps'
      ? t('location_quality_gps_precise')
      : locationSource === 'ip'
      ? t('location_quality_ip_approximate')
      : locationSource === 'exif'
      ? t('location_quality_exif')
      : locationSource === 'address'
      ? t('location_quality_address_selected')
      : locationSource === 'manual'
      ? t('location_quality_manual')
      : t('location_quality_unset');
  const locationQualityClass =
    locationSource === 'gps'
      ? 'is-precise'
      : locationSource === 'ip'
      ? 'is-approx'
      : locationSource === 'address' || locationSource === 'manual' || locationSource === 'exif'
      ? 'is-manual'
      : 'is-empty';
  const shouldAutoLocateMapOnOpen =
    locationSource !== 'address' && locationSource !== 'manual' && locationSource !== 'exif';
  const submissionKicker = citizenProfileTexts.submissionKicker || t('page_kicker_submission');
  const submissionTitle = citizenProfileTexts.submissionTitle || t('page_title_submission');
  const submissionSubtitle = citizenProfileTexts.submissionSubtitle || t('page_subtitle_submission');

  return (
    <main className="page-shell">
      <header className="page-head">
        <p className="page-kicker">{submissionKicker}</p>
        <h1 className="page-title">{submissionTitle}</h1>
        <p className="page-subtitle">{submissionSubtitle}</p>
      </header>

      <section
        ref={formCardRef}
        className={`form-card ${step === 'preview' ? 'form-card--preview' : ''}`}
      >
        {maintenanceMode && (
          <div className="p-6 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
            <h2 className="text-lg font-semibold mb-2">{t('maintenance_title')}</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm text-amber-700 mb-3">
              <span><i className="fa-solid fa-screwdriver-wrench" /> {t('maintenance_badge_maintenance')}</span>
              <span><i className="fa-solid fa-triangle-exclamation" /> {t('maintenance_badge_patience')}</span>
              <span><i className="fa-solid fa-traffic-cone" /> {t('maintenance_badge_temporarily_locked')}</span>
            </div>
            <p className="text-sm text-amber-800">
              {maintenanceMessage || t('maintenance_message')}
            </p>
          </div>
        )}

        {error && (
          <Alert type="error" message={error} dismissible={true} onDismiss={() => setError('')} />
        )}
        {!maintenanceMode && <ProgressBar current={step === 'input' ? 1 : 2} total={2} />}

        {!maintenanceMode && step === 'input' && (
          <form onSubmit={handlePreview} className="form-stack" autoComplete="off">
            <div className="form-inline-grid">
              <FormField
                label={t('field_name_label')}
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                required={true}
                placeholder={t('field_name_placeholder')}
                tooltip={t('tooltip_name')}
              />

              <FormField
                label={t('field_email_label')}
                name="email"
                type="email"
                value={formData.email}
                onChange={handleInputChange}
                required={true}
                placeholder={t('field_email_placeholder')}
                tooltip={t('tooltip_email')}
                disabled={citizenAuthenticated}
              />
            </div>

            {citizenAuthEnabled && citizenAuthenticated && (
              <p className="text-xs text-slate-600 -mt-3 mb-3 flex items-start gap-2">
                <i className="fa-solid fa-user-check mt-0.5" aria-hidden="true" />
                Angemeldet als {citizenSessionEmail || formData.email}. Meldungen werden diesem Konto zugeordnet.
              </p>
            )}

            <FormField
              label={t('field_description_label')}
              name="description"
              type="textarea"
              value={formData.description}
              onChange={handleInputChange}
              required={true}
              placeholder={t('field_description_placeholder')}
              rows={5}
              tooltip={t('tooltip_description')}
            />
            <p className="text-xs text-slate-600 -mt-3 mb-3 flex items-start gap-2">
              <i className="fa-solid fa-circle-info mt-0.5" aria-hidden="true" />
              {t('description_ai_notice')}
            </p>

            <div className="form-group">
              <label htmlFor="photo-upload" className="section-label">
                {t('field_photos_label')}
                <span className="ml-2 text-slate-400" title={t('tooltip_photos')} aria-label={t('tooltip_photos')}>
                  <i className="fa-solid fa-circle-info" aria-hidden="true" />
                </span>
              </label>
              <div
                className={`upload-dropzone ${isDragActive ? 'is-drag' : ''}`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setIsDragActive(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragActive(true);
                }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={handleDrop}
              >
                <input
                  id="photo-upload"
                  type="file"
                  multiple
                  onChange={handleImageChange}
                />
                <div className="upload-content">
                  <p className="upload-title">{t('upload_title')}</p>
                  <p className="upload-hint">
                    {t('upload_hint', { max: MAX_IMAGES, size: MAX_IMAGE_SIZE_MB })}
                  </p>
                </div>
              </div>
              {imageError && <p className="text-sm text-red-600 mt-2">{imageError}</p>}
              {images.length > 0 && (
                <div className="upload-grid">
                  {images.map((image) => (
                    <div key={image.id} className="upload-thumb">
                      {image.isImage && image.previewUrl ? (
                        <img src={image.previewUrl} alt={image.name} />
                      ) : (
                        <div className="upload-file-placeholder" aria-label={image.name}>
                          <i className="fa-solid fa-file-circle-check" aria-hidden="true" />
                        </div>
                      )}
                      <div className="upload-meta">
                        <span className="upload-name">{image.name}</span>
                        <span className="upload-size">
                          {(image.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        {image.isImage && (
                          <span className={`upload-exif-status upload-exif-status--${image.exifStatus}`}>
                            <i
                              className={`fa-solid ${
                                image.exifStatus === 'pending'
                                  ? 'fa-spinner fa-spin'
                                  : image.exifStatus === 'found'
                                  ? 'fa-location-dot'
                                  : 'fa-ban'
                              }`}
                              aria-hidden="true"
                            />{' '}
                            {image.exifStatus === 'pending'
                              ? t('upload_exif_status_pending')
                              : image.exifStatus === 'found'
                              ? t('upload_exif_status_found')
                              : t('upload_exif_status_none')}
                          </span>
                        )}
                        {image.isImage && image.exifStatus === 'found' && image.exifGps && (
                          <span className="upload-exif-inline-coordinates">
                            {image.exifGps.latitude.toFixed(6)}, {image.exifGps.longitude.toFixed(6)}
                          </span>
                        )}
                      </div>
                      {image.isImage && image.exifStatus === 'found' && image.exifGps && (
                        <button
                          type="button"
                          className="upload-exif-apply"
                          disabled={applyingExifImageId !== null}
                          onClick={() => {
                            void handleApplyImageExifLocation(image);
                          }}
                        >
                          {applyingExifImageId === image.id ? t('map_loading') : t('upload_exif_apply')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="upload-remove"
                        onClick={() => removeImage(image.id)}
                      >
                        {t('upload_remove')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {(checkingExifLocation || exifPendingCount > 0) && (
                <p className="upload-exif-checking">
                  <i className="fa-solid fa-image" aria-hidden="true" /> {t('upload_exif_checking')}
                </p>
              )}
              {exifImageCount > 0 && (
                <div className="upload-exif-suggestion" role="status" aria-live="polite">
                  <p className="upload-exif-title">
                    <i className="fa-solid fa-location-dot" aria-hidden="true" />{' '}
                    {t('upload_exif_images_count', { count: exifImageCount })}
                  </p>
                  <p className="upload-exif-coordinates">
                    {t('upload_exif_apply_hint')}
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="section-label">
                {t('field_location_label')}
                <span className="text-slate-500 ml-1 text-sm">({t('field_optional')})</span>
                <span className="ml-2 text-slate-400" title={t('tooltip_location')} aria-label={t('tooltip_location')}>
                  <i className="fa-solid fa-circle-info" aria-hidden="true" />
                </span>
              </label>
              <AddressSearch
                key={addressSearchResetKey}
                value={formData.address}
                onChange={(value) => {
                  setFormData((prev) => ({ ...prev, address: value }));
                  setLocationSource('manual');
                  setAddressAutocompleteEnabled(value.trim().length > 0);
                }}
                autocompleteEnabled={addressAutocompleteEnabled}
                onAddressSelect={handleAddressSelect}
              />
              <div className="location-state-row">
                <span className={`location-quality-badge ${locationQualityClass}`}>
                  <i
                    className={`fa-solid ${
                      locationSource === 'gps'
                        ? 'fa-satellite-dish'
                        : locationSource === 'ip'
                        ? 'fa-location-crosshairs'
                        : locationSource === 'exif'
                        ? 'fa-image'
                        : locationSource === 'address'
                        ? 'fa-house'
                        : locationSource === 'manual'
                        ? 'fa-location-dot'
                        : 'fa-circle'
                    }`}
                  />{' '}
                  {locationQualityLabel}
                </span>
                {restrictLocations && geofenceState !== null && (
                  <span className={`location-geofence-badge ${geofenceState ? 'inside' : 'outside'}`}>
                    <i className={`fa-solid ${geofenceState ? 'fa-circle-check' : 'fa-triangle-exclamation'}`} />{' '}
                    {geofenceState ? t('location_geofence_inside') : t('location_geofence_outside')}
                  </span>
                )}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  className="map-toggle-btn"
                  onClick={handleDetectLocation}
                  disabled={detectingLocation}
                >
                  {detectingLocation ? t('map_loading') : t('map_geo_button')}
                </button>
              </div>
            </div>
            <div className="map-toggle">
              <button
                type="button"
                className="map-toggle-btn"
                onClick={() => setShowMap((prev) => !prev)}
              >
                {showMap ? t('map_toggle_hide') : t('map_toggle_show')}
              </button>
              <p className="map-toggle-hint">
                {t('map_toggle_hint')}
              </p>
            </div>
            {showMap && (
              <LocationMap
                onLocationChange={handleLocationChange}
                updateLocation={mapUpdate}
                autoLocateOnMount={shouldAutoLocateMapOnOpen}
                jurisdictionGeofence={jurisdictionGeofence}
              />
            )}

            <div className="mt-4">
              <label className="flex items-start gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    if (e.target.checked) setConsentError('');
                  }}
                />
                <span>{t('consent_label')}</span>
              </label>
              <p className="text-xs text-slate-600 mt-2 ml-7">{t('consent_hint')}</p>
              {consentError && (
                <p className="text-sm text-red-600 mt-2 flex items-center gap-2">
                  <i className="fa-solid fa-circle-xmark" aria-hidden="true" />
                  {consentError}
                </p>
              )}
            </div>

          <div className="submission-input-actions">
            <ActionButton type="submit" variant="primary" size="large" fullWidth={true}>
              {t('button_show_summary')}
            </ActionButton>
          </div>
          </form>
        )}

      {step === 'preview' && (
        <div className="space-y-6">
          <div className="p-5 rounded-xl bg-slate-900 text-slate-100">
            <h2 className="text-lg font-semibold mb-2">{t('summary_title')}</h2>
            <p className="text-sm text-slate-300">
              {t('summary_hint')}
            </p>
          </div>

          <div className="summary-grid">
            <SummaryItem label={t('summary_label_name')} value={formData.name} iconClass="fa-solid fa-user" />
            <SummaryItem label={t('summary_label_email')} value={formData.email} iconClass="fa-solid fa-envelope" />
            <SummaryItem label={t('summary_label_description')} value={formData.description} iconClass="fa-solid fa-pen-to-square" />
            <SummaryItem label={t('summary_label_address')} value={addressSummary} iconClass="fa-solid fa-location-dot" />
            <SummaryItem label={t('summary_label_location_quality')} value={locationQualityLabel} iconClass="fa-solid fa-crosshairs" />
            {images.length > 0 && (
              <SummaryItem
                label={t('summary_label_photos')}
                value={`${images.length} ${t(images.length > 1 ? 'summary_photos_plural' : 'summary_photos_singular')}`}
                iconClass="fa-solid fa-camera"
              />
            )}
            {formData.latitude && formData.longitude && (
              <SummaryItem
                label={t('summary_label_coordinates')}
                value={`${formData.latitude.toFixed(6)}, ${formData.longitude.toFixed(6)}`}
                iconClass="fa-solid fa-compass"
              />
            )}
          </div>

          <div className="submission-preview-actions flex flex-col sm:flex-row gap-3">
            <ActionButton variant="secondary" onClick={() => setStep('input')}>
              {t('button_back')}
            </ActionButton>
            <div className="submission-preview-submit-inline">
              <ActionButton variant="primary" onClick={handleSubmit} loading={loading} fullWidth={true}>
                {t('button_submit_verify')}
              </ActionButton>
            </div>
          </div>
          <button
            type="button"
            className="submission-mobile-submit-fab"
            onClick={handleSubmit}
            disabled={loading}
            aria-label={t('button_submit_verify')}
            title={t('button_submit_verify')}
          >
            {loading ? (
              <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
            ) : (
              <i className="fa-solid fa-paper-plane" aria-hidden="true" />
            )}
          </button>
        </div>
      )}

      </section>

      {showNoLocationConfirm && (
        <div className="warning-modal" role="alertdialog" aria-modal="true" aria-live="assertive">
          <div className="warning-card">
            <h2>{t('location_confirm_title')}</h2>
            <p>{t('location_confirm_body')}</p>
            <div className="warning-actions">
              <button
                type="button"
                className="warning-cancel"
                onClick={() => setShowNoLocationConfirm(false)}
              >
                {t('location_confirm_cancel')}
              </button>
              <button
                type="button"
                className="warning-confirm"
                onClick={() => {
                  setShowNoLocationConfirm(false);
                  setStep('preview');
                }}
              >
                {t('location_confirm_submit_without')}
              </button>
            </div>
          </div>
        </div>
      )}

      {warningModalMessage && (
        <div className="warning-modal" role="alertdialog" aria-modal="true" aria-live="assertive">
          <div className="warning-card">
            <h2>{t('warning_title')}</h2>
            <p>{warningModalMessage}</p>
            <p className="warning-note">
              {warningModalVariant === 'form' ? t('warning_form_reset_note') : t('warning_location_rejected_note')}
            </p>
            <button
              type="button"
              className="warning-confirm"
              onClick={() => {
                setWarningModalMessage('');
                setWarningModalVariant('form');
              }}
            >
              {t('warning_button_back_form')}
            </button>
          </div>
        </div>
      )}

      {exifPromptImage && exifPromptImage.exifStatus === 'found' && exifPromptImage.exifGps && (
        <div className="exif-prompt-modal" role="dialog" aria-modal="true" aria-live="polite">
          <div className="exif-prompt-card">
            <h2>{t('upload_exif_prompt_title')}</h2>
            <p>{t('upload_exif_prompt_body', { file: exifPromptImage.name })}</p>
            <p className="exif-prompt-coordinates">
              {exifPromptImage.exifGps.latitude.toFixed(6)}, {exifPromptImage.exifGps.longitude.toFixed(6)}
            </p>
            <div className="exif-prompt-actions">
              <button
                type="button"
                className="exif-prompt-secondary"
                onClick={() => setExifPromptImageId(null)}
              >
                {t('upload_exif_prompt_later')}
              </button>
              <button
                type="button"
                className="exif-prompt-muted"
                onClick={() => {
                  setExifPromptSuppressed(true);
                  setExifPromptImageId(null);
                }}
              >
                {t('upload_exif_prompt_never')}
              </button>
              <button
                type="button"
                className="exif-prompt-primary"
                onClick={() => {
                  void handleApplyImageExifLocation(exifPromptImage);
                }}
                disabled={applyingExifImageId !== null}
              >
                {applyingExifImageId === exifPromptImage.id
                  ? t('map_loading')
                  : t('upload_exif_prompt_apply_now')}
              </button>
            </div>
          </div>
        </div>
      )}

      {successModal.open && (
        <div className="success-modal" role="dialog" aria-modal="true" aria-live="polite">
          <div className="success-modal-card">
            <button
              type="button"
              className="success-modal-close"
              aria-label={t('success_modal_close')}
              title={t('success_modal_close')}
              onClick={() => setSuccessModal(INITIAL_SUCCESS_MODAL)}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
            <div className="success-modal-head">
              <div className="success-modal-icon" aria-hidden="true">
                <i className="fa-solid fa-circle-check" />
              </div>
              <div className="success-modal-copy">
                <h2>{t('success_title')}</h2>
                <p>{successModal.message || t('success_message')}</p>
                {!citizenAuthenticated && (
                  <p className="success-modal-validation-note">{t('success_email_validation_note')}</p>
                )}
                <p className="success-modal-ticket">
                  {t('success_ticket_label')}: {successModal.ticketId || '–'}
                </p>
              </div>
            </div>
            <div className="success-modal-actions">
              <button
                type="button"
                className="success-modal-primary"
                onClick={() => setSuccessModal(INITIAL_SUCCESS_MODAL)}
              >
                {t('button_new_submission')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default SubmissionForm;
