import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './LocationMap.css';
import { useI18n } from '../i18n/I18nProvider';

interface LocationMapProps {
  onLocationChange: (location: {
    latitude: number;
    longitude: number;
    address: string;
    postalCode?: string;
    city?: string;
    source?: 'gps' | 'ip' | 'manual' | 'address';
  }) => void;
  updateLocation?: { latitude: number; longitude: number } | null;
  autoLocateOnMount?: boolean;
  jurisdictionGeofence?: {
    enabled?: boolean;
    shape?: 'circle' | 'polygon';
    centerLat?: number;
    centerLon?: number;
    radiusMeters?: number;
    points?: Array<{ lat: number; lon: number }>;
  };
}

const LocationMap: React.FC<LocationMapProps> = ({
  onLocationChange,
  updateLocation,
  autoLocateOnMount = true,
  jurisdictionGeofence,
}) => {
  const { t } = useI18n();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const geofenceLayerGroup = useRef<L.LayerGroup | null>(null);
  const reverseGeocodeRequestId = useRef(0);
  const reverseGeocodeAbortRef = useRef<AbortController | null>(null);
  const reverseGeocodeTimerRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentAddress, setCurrentAddress] = useState('');
  const markerIcon = L.divIcon({
    className: 'custom-location-marker',
    html: `
      <span class="custom-location-marker-pin">
        <span class="custom-location-marker-core"></span>
      </span>
      <span class="custom-location-marker-shadow"></span>
    `,
    iconSize: [44, 56],
    iconAnchor: [22, 52],
    popupAnchor: [0, -46],
  });

  const getCurrentPosition = (options: PositionOptions): Promise<GeolocationPosition> =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });

  const normalizeGeofencePoints = (input: unknown): Array<{ lat: number; lon: number }> => {
    if (!Array.isArray(input)) return [];
    return input
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const lat = Number((entry as any).lat ?? (entry as any).latitude);
        const lon = Number((entry as any).lon ?? (entry as any).lng ?? (entry as any).longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { lat, lon };
      })
      .filter((entry): entry is { lat: number; lon: number } => entry !== null);
  };

  const buildCirclePolygonPoints = (
    centerLat: number,
    centerLon: number,
    radiusMeters: number,
    segments = 96
  ): Array<{ lat: number; lon: number }> => {
    const points: Array<{ lat: number; lon: number }> = [];
    const earthRadius = 6371000;
    const angularDistance = radiusMeters / earthRadius;
    const latRad = (centerLat * Math.PI) / 180;
    const lonRad = (centerLon * Math.PI) / 180;

    for (let index = 0; index < segments; index += 1) {
      const bearing = (2 * Math.PI * index) / segments;
      const sinLat = Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing);
      const pointLat = Math.asin(sinLat);
      const pointLon =
        lonRad +
        Math.atan2(
          Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
          Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(pointLat)
        );
      points.push({
        lat: (pointLat * 180) / Math.PI,
        lon: (pointLon * 180) / Math.PI,
      });
    }
    return points;
  };

  const renderGeofenceOverlay = () => {
    const mapInstance = map.current;
    const layerGroup = geofenceLayerGroup.current;
    if (!mapInstance || !layerGroup) return;
    layerGroup.clearLayers();

    if (!jurisdictionGeofence?.enabled) return;

    const geofenceShape = jurisdictionGeofence.shape === 'polygon' ? 'polygon' : 'circle';
    let allowedPoints = normalizeGeofencePoints(jurisdictionGeofence.points);
    if (geofenceShape === 'circle') {
      const centerLat = Number(jurisdictionGeofence.centerLat);
      const centerLon = Number(jurisdictionGeofence.centerLon);
      const radiusMeters = Number.isFinite(Number(jurisdictionGeofence.radiusMeters))
        ? Math.max(1, Number(jurisdictionGeofence.radiusMeters))
        : 5000;
      if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) {
        return;
      }
      allowedPoints = buildCirclePolygonPoints(centerLat, centerLon, radiusMeters, 96);
      L.circle([centerLat, centerLon], {
        radius: radiusMeters,
        color: '#0f5132',
        weight: 2,
        fill: false,
        interactive: false,
      }).addTo(layerGroup);
    } else {
      if (allowedPoints.length < 3) return;
      L.polygon(
        allowedPoints.map((point) => [point.lat, point.lon] as L.LatLngTuple),
        {
          color: '#0f5132',
          weight: 2,
          fill: false,
          interactive: false,
        }
      ).addTo(layerGroup);
    }

    if (allowedPoints.length >= 3) {
      const worldRing: L.LatLngTuple[] = [
        [85, -180],
        [85, 180],
        [-85, 180],
        [-85, -180],
      ];
      const allowedRing = [...allowedPoints]
        .map((point) => [point.lat, point.lon] as L.LatLngTuple)
        .reverse();
      L.polygon([worldRing, allowedRing], {
        stroke: false,
        fillColor: '#111827',
        fillOpacity: 0.52,
        interactive: false,
      }).addTo(layerGroup);
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
      // continue
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

  const resolveCoordinates = async (): Promise<{ latitude: number; longitude: number; approximate: boolean }> => {
    const isSecure = window.isSecureContext || window.location.hostname === 'localhost';

    if (!isSecure) {
      const approximate = await getApproximateCoordinatesFromIp();
      if (approximate) return { ...approximate, approximate: true };
      throw new Error('insecure');
    }

    if (!navigator.geolocation) {
      const approximate = await getApproximateCoordinatesFromIp();
      if (approximate) return { ...approximate, approximate: true };
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
        approximate: false,
      };
    } catch (error) {
      const geoError = error as GeolocationPositionError;
      if (geoError?.code === 2 || geoError?.code === 3) {
        try {
          const second = await getCurrentPosition({
            timeout: 20000,
            enableHighAccuracy: false,
            maximumAge: 300000,
          });
          return {
            latitude: second.coords.latitude,
            longitude: second.coords.longitude,
            approximate: false,
          };
        } catch (secondError) {
          const approximate = await getApproximateCoordinatesFromIp();
          if (approximate) return { ...approximate, approximate: true };
          throw secondError;
        }
      }
      const approximate = await getApproximateCoordinatesFromIp();
      if (approximate) return { ...approximate, approximate: true };
      throw geoError;
    }
  };

  const placeMarkerAt = (
    latitude: number,
    longitude: number,
    source: 'gps' | 'ip' | 'manual' | 'address'
  ) => {
    const coords = [latitude, longitude] as [number, number];
    if (map.current) {
      map.current.setView(coords, 15);
    }
    if (marker.current) {
      marker.current.remove();
    }
    marker.current = L.marker(coords, { icon: markerIcon, draggable: true }).addTo(map.current!);
    configureMarker(marker.current);
    scheduleReverseGeocode(latitude, longitude, source);
  };

  const locateAndPlaceMarker = async (options: { silent?: boolean } = {}) => {
    const silent = options.silent === true;
    if (!silent) {
      setIsLoading(true);
      setError('');
    }
    try {
      const resolved = await resolveCoordinates();
      placeMarkerAt(resolved.latitude, resolved.longitude, resolved.approximate ? 'ip' : 'gps');
      if (!silent && resolved.approximate) {
        setError(t('geo_info_approximate_location'));
      }
    } catch (geoError) {
      if (silent) {
        return;
      }
      const err = geoError as GeolocationPositionError;
      let errorMsg = t('geo_error_fallback_full');

      if (err?.code === 1) {
        errorMsg = t('geo_error_permission_full');
      } else if (err?.code === 2 || err?.code === 3) {
        errorMsg = t('geo_error_fallback_full');
      } else if ((geoError as Error)?.message === 'insecure') {
        errorMsg = t('geo_error_https');
      } else if ((geoError as Error)?.message === 'not_supported') {
        errorMsg = t('geo_error_unsupported');
      }

      setError(errorMsg);
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  // Initialize map with user's current location
  useEffect(() => {
    if (!mapContainer.current) return;

    // Create map instance
    map.current = L.map(mapContainer.current).setView([49.5038, 7.7708], 13); // Default: Otterberg

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map.current);

    geofenceLayerGroup.current = L.layerGroup().addTo(map.current);
    renderGeofenceOverlay();

    const hasInitialLocation =
      !!updateLocation &&
      Number.isFinite(updateLocation.latitude) &&
      Number.isFinite(updateLocation.longitude);
    if (autoLocateOnMount && !hasInitialLocation) {
      void locateAndPlaceMarker({ silent: true });
    }

    // Handle map clicks to place marker
    const handleMapClick = (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;

      if (marker.current) {
        marker.current.remove();
      }

      marker.current = L.marker([lat, lng], { icon: markerIcon, draggable: true }).addTo(map.current!);
      configureMarker(marker.current);
      scheduleReverseGeocode(lat, lng, 'manual');
    };

    map.current.on('click', handleMapClick);

    return () => {
      if (reverseGeocodeTimerRef.current !== null) {
        window.clearTimeout(reverseGeocodeTimerRef.current);
      }
      reverseGeocodeAbortRef.current?.abort();
      if (map.current) {
        map.current.off('click', handleMapClick);
        map.current.remove();
      }
      geofenceLayerGroup.current = null;
    };
  }, []);

  useEffect(() => {
    renderGeofenceOverlay();
  }, [jurisdictionGeofence]);

  // Reverse geocode coordinates to address using Nominatim
  const reverseGeocode = async (
    latitude: number,
    longitude: number,
    source: 'gps' | 'ip' | 'manual' | 'address'
  ) => {
    const requestId = reverseGeocodeRequestId.current + 1;
    reverseGeocodeRequestId.current = requestId;
    reverseGeocodeAbortRef.current?.abort();
    const controller = new AbortController();
    reverseGeocodeAbortRef.current = controller;
    const fallbackAddress = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

    // Ensure address field updates immediately when marker is moved,
    // even before reverse geocoding has finished.
    setCurrentAddress(fallbackAddress);
    onLocationChange({
      latitude,
      longitude,
      address: fallbackAddress,
      postalCode: '',
      city: '',
      source,
    });

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
        { signal: controller.signal }
      );
      const data = await response.json();
      if (requestId !== reverseGeocodeRequestId.current) return;

      const address = data.address || {};
      const fullAddress = [
        address.road,
        address.house_number,
        address.postcode,
        address.city || address.town || address.village,
      ]
        .filter(Boolean)
        .join(' ');

      setCurrentAddress(fullAddress || t('map_unknown_address'));

      onLocationChange({
        latitude,
        longitude,
        address: fullAddress || fallbackAddress,
        postalCode: address.postcode || '',
        city: address.city || address.town || address.village || '',
        source,
      });
    } catch (err) {
      if (requestId !== reverseGeocodeRequestId.current) return;
      console.error('Nominatim reverse geocoding error:', err);
      setCurrentAddress(fallbackAddress);
      onLocationChange({
        latitude,
        longitude,
        address: fallbackAddress,
        postalCode: '',
        city: '',
        source,
      });
    }
  };

  const scheduleReverseGeocode = (
    latitude: number,
    longitude: number,
    source: 'gps' | 'ip' | 'manual' | 'address'
  ) => {
    if (reverseGeocodeTimerRef.current !== null) {
      window.clearTimeout(reverseGeocodeTimerRef.current);
    }
    reverseGeocodeTimerRef.current = window.setTimeout(() => {
      reverseGeocodeTimerRef.current = null;
      void reverseGeocode(latitude, longitude, source);
    }, 220);
  };

  const configureMarker = (markerInstance: L.Marker) => {
    markerInstance.off('dragend');
    markerInstance.on('dragend', () => {
      const position = markerInstance.getLatLng();
      scheduleReverseGeocode(position.lat, position.lng, 'manual');
    });
    markerInstance.dragging?.enable();
  };

  // Handle external location updates from AddressSearch
  useEffect(() => {
    if (updateLocation && map.current) {
      const { latitude, longitude } = updateLocation;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
      }

      const currentMarkerPosition = marker.current?.getLatLng();
      if (
        currentMarkerPosition &&
        Math.abs(currentMarkerPosition.lat - latitude) < 0.0000001 &&
        Math.abs(currentMarkerPosition.lng - longitude) < 0.0000001
      ) {
        return;
      }

      // Update map view
      map.current.setView([latitude, longitude], 15);

      // Update marker position
      if (marker.current) {
        marker.current.setLatLng([latitude, longitude]);
        configureMarker(marker.current);
      } else {
        marker.current = L.marker([latitude, longitude], { icon: markerIcon, draggable: true }).addTo(map.current);
        configureMarker(marker.current);
      }

      // Get address for the new location
      scheduleReverseGeocode(latitude, longitude, 'address');
    }
  }, [updateLocation]);

  return (
    <div className="location-map-container">
      <h3>{t('map_title')}</h3>
      <button
        type="button"
        className="location-geo-btn"
        onClick={() => {
          void locateAndPlaceMarker();
        }}
      >
        {t('map_geo_button')}
      </button>
      {error && <div className="location-error">{error}</div>}
      {isLoading && <div className="location-loading">{t('map_loading')}</div>}

      <div ref={mapContainer} className="map-container" />
      {jurisdictionGeofence?.enabled && (
        <div className="location-geofence-legend">
          <span className="legend-item legend-allow">
            <span className="legend-swatch" /> Freigegebener Bereich
          </span>
          <span className="legend-item legend-block">
            <span className="legend-swatch" /> Gesperrter Bereich
          </span>
        </div>
      )}

      <div className="location-info">
        <p className="location-label">{t('map_current_label')}</p>
        <p className="location-address">{currentAddress || t('map_current_none')}</p>
      </div>

      <div className="map-instructions">
        <p><i className="fa-solid fa-circle-info" /> {t('map_instruction')}</p>
      </div>
    </div>
  );
};

export default LocationMap;
