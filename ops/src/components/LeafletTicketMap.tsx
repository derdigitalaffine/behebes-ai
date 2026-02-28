import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface LeafletTicketMapProps {
  latitude: number;
  longitude: number;
  title?: string;
}

export default function LeafletTicketMap({ latitude, longitude, title }: LeafletTicketMapProps) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapNodeRef.current) return;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapNodeRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([latitude, longitude], 17);
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const marker = L.circleMarker([latitude, longitude], {
      radius: 8,
      color: '#14539f',
      weight: 2,
      fillColor: '#22c55e',
      fillOpacity: 0.85,
    }).addTo(map);

    if (title) {
      marker.bindPopup(String(title), {
        closeButton: false,
        autoClose: false,
      }).openPopup();
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [latitude, longitude, title]);

  return (
    <Box
      sx={{
        borderRadius: 2,
        overflow: 'hidden',
        border: '1px solid #d1d5db',
        height: 300,
        '& .leaflet-container': {
          fontFamily: 'inherit',
        },
      }}
    >
      <div ref={mapNodeRef} style={{ width: '100%', height: '100%' }} />
    </Box>
  );
}

