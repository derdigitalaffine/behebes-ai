import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import CropSquareRoundedIcon from '@mui/icons-material/CropSquareRounded';
import DoneRoundedIcon from '@mui/icons-material/DoneRounded';
import FilterAltOffRoundedIcon from '@mui/icons-material/FilterAltOffRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PolylineRoundedIcon from '@mui/icons-material/PolylineRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded';
import CenterFocusStrongRoundedIcon from '@mui/icons-material/CenterFocusStrongRounded';
import BackspaceRoundedIcon from '@mui/icons-material/BackspaceRounded';
import ZoomOutMapRoundedIcon from '@mui/icons-material/ZoomOutMapRounded';
import RoomRoundedIcon from '@mui/icons-material/RoomRounded';
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded';
import { Link, useNavigate } from 'react-router-dom';
import {
  SmartTable,
  SmartTableRowActionButton,
  SmartTableRowActions,
  useSmartTableLiveRefresh,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import './Tickets.css';
import './TicketMap.css';

interface Ticket {
  id: string;
  submissionId?: string;
  citizenName?: string;
  citizenEmail?: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending_validation' | 'pending' | 'open' | 'assigned' | 'in-progress' | 'completed' | 'closed';
  address?: string;
  city?: string;
  postalCode?: string;
  latitude?: number | null;
  longitude?: number | null;
  createdAt: string;
  updatedAt?: string;
  workflowStarted?: boolean;
  workflowStatus?: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | null;
  workflowTemplateId?: string | null;
  workflowExecutionId?: string | null;
  assignedTo?: string | null;
  primaryAssigneeUserId?: string | null;
  primaryAssigneeOrgUnitId?: string | null;
  owningOrgUnitId?: string | null;
  imageCount?: number;
  hasImages?: boolean;
}

type SelectionMode = 'none' | 'rectangle' | 'polygon';
type WorkflowFilter = 'all' | 'with' | 'without' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
type BaseLayerId = 'street' | 'topo' | 'imagery';
type HotspotWindowDays = 30 | 90 | 180;

type ClusterItem = {
  id: string;
  latitude: number;
  longitude: number;
  tickets: Ticket[];
};

type MapViewportBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

type HotspotPoint = {
  latitude: number;
  longitude: number;
  count: number;
};

interface AnalyticsHotspotResponse {
  mapHotspots?: Array<{
    latitude?: number;
    longitude?: number;
    count?: number;
  }>;
}

const STATUS_LABELS: Record<string, string> = {
  pending_validation: 'Validierung ausstehend',
  pending: 'Ausstehend',
  open: 'Offen',
  assigned: 'Zugewiesen',
  'in-progress': 'In Bearbeitung',
  completed: 'Abgeschlossen',
  closed: 'Geschlossen',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  critical: 'Kritisch',
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  RUNNING: 'Läuft',
  PAUSED: 'Pausiert',
  COMPLETED: 'Abgeschlossen',
  FAILED: 'Fehler',
};

const BASE_LAYER_OPTIONS: Array<{ id: BaseLayerId; label: string }> = [
  { id: 'street', label: 'Straßenkarte' },
  { id: 'topo', label: 'Topografie' },
  { id: 'imagery', label: 'Satellit' },
];

const HOTSPOT_WINDOW_OPTIONS: Array<{ value: HotspotWindowDays; label: string }> = [
  { value: 30, label: '30 Tage' },
  { value: 90, label: '90 Tage' },
  { value: 180, label: '180 Tage' },
];

const BASE_LAYER_CONFIG: Record<BaseLayerId, { url: string; options: L.TileLayerOptions }> = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 17,
      attribution: 'Kartendaten: © OpenStreetMap contributors, SRTM | Darstellung: © OpenTopoMap',
    },
  },
  imagery: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      attribution: 'Tiles © Esri',
    },
  },
};

const GIS_DEFAULT_CENTER: L.LatLngTuple = [49.5038, 7.7708]; // Otterberg
const GIS_DEFAULT_ZOOM = 13;

const statusColor = (status: string): string => {
  switch (status) {
    case 'open':
      return '#dc2626';
    case 'pending_validation':
      return '#2563eb';
    case 'pending':
    case 'in-progress':
      return '#d97706';
    case 'assigned':
      return '#0ea5e9';
    case 'completed':
      return '#16a34a';
    case 'closed':
      return '#475569';
    default:
      return '#334155';
  }
};

const parseDate = (value?: string) => {
  if (!value) return 0;
  const ts = parseInt(value, 10);
  if (!Number.isNaN(ts) && ts > 1000000000) return ts;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const hasCoordinates = (ticket: Ticket) => {
  const lat = Number(ticket.latitude);
  const lon = Number(ticket.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon);
};

const formatLocation = (ticket: Ticket) => {
  const bits = [ticket.address, ticket.postalCode, ticket.city].filter(Boolean);
  return bits.length ? bits.join(', ') : '–';
};

const isTicketInsideViewport = (ticket: Ticket, bounds: MapViewportBounds | null) => {
  if (!bounds || !hasCoordinates(ticket)) return false;
  const lat = Number(ticket.latitude);
  const lon = Number(ticket.longitude);
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
};

const isPointInsidePolygon = (lat: number, lon: number, points: Array<{ lat: number; lon: number }>) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const yi = points[i].lat;
    const xi = points[i].lon;
    const yj = points[j].lat;
    const xj = points[j].lon;
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

const clusterTickets = (tickets: Ticket[], zoom: number): ClusterItem[] => {
  if (zoom >= 14) {
    return tickets
      .filter(hasCoordinates)
      .map((ticket) => ({
        id: ticket.id,
        latitude: Number(ticket.latitude),
        longitude: Number(ticket.longitude),
        tickets: [ticket],
      }));
  }

  const cellSize = zoom <= 9 ? 0.09 : zoom <= 11 ? 0.045 : 0.025;
  const groups = new Map<string, Ticket[]>();

  tickets.forEach((ticket) => {
    if (!hasCoordinates(ticket)) return;
    const lat = Number(ticket.latitude);
    const lon = Number(ticket.longitude);
    const cellLat = Math.floor(lat / cellSize);
    const cellLon = Math.floor(lon / cellSize);
    const key = `${cellLat}:${cellLon}`;
    const current = groups.get(key) || [];
    current.push(ticket);
    groups.set(key, current);
  });

  return Array.from(groups.entries()).map(([key, group]) => {
    const latitude = group.reduce((sum, item) => sum + Number(item.latitude), 0) / group.length;
    const longitude = group.reduce((sum, item) => sum + Number(item.longitude), 0) / group.length;
    return {
      id: `cluster:${key}`,
      latitude,
      longitude,
      tickets: group,
    };
  });
};

const TicketMap: React.FC<{ token: string }> = ({ token }) => {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [hotspots, setHotspots] = useState<HotspotPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hotspotsLoading, setHotspotsLoading] = useState(false);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowFilter>('all');
  const [search, setSearch] = useState('');
  const [onlyMapped, setOnlyMapped] = useState(true);
  const [limitToViewport, setLimitToViewport] = useState(false);

  const [baseLayerId, setBaseLayerId] = useState<BaseLayerId>('street');
  const [showHotspots, setShowHotspots] = useState(false);
  const [hotspotWindowDays, setHotspotWindowDays] = useState<HotspotWindowDays>(90);

  const [mapReady, setMapReady] = useState(false);
  const [mapZoom, setMapZoom] = useState(12);
  const [mapViewport, setMapViewport] = useState<MapViewportBounds | null>(null);

  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionHint, setSelectionHint] = useState('');
  const [polygonPointCount, setPolygonPointCount] = useState(0);
  const [rectanglePending, setRectanglePending] = useState(false);

  const [bulkReason, setBulkReason] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkPriority, setBulkPriority] = useState('');
  const [bulkWorkflow, setBulkWorkflow] = useState(false);
  const [bulkWorkflowTemplateId, setBulkWorkflowTemplateId] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [geocodeBatchLoading, setGeocodeBatchLoading] = useState(false);
  const [queueBusyByTicket, setQueueBusyByTicket] = useState<Record<string, boolean>>({});

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayersRef = useRef<Record<BaseLayerId, L.TileLayer> | null>(null);
  const activeBaseLayerRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const selectionLayerRef = useRef<L.LayerGroup | null>(null);
  const hotspotLayerRef = useRef<L.LayerGroup | null>(null);
  const markerByTicketRef = useRef<Map<string, L.Layer>>(new Map());
  const rectangleStartRef = useRef<L.LatLng | null>(null);
  const polygonDraftRef = useRef<L.LatLng[]>([]);
  const selectionModeRef = useRef<SelectionMode>('none');
  const mappedTicketsRef = useRef<Ticket[]>([]);
  const hasAutoFittedRef = useRef(false);
  const userMovedMapRef = useRef(false);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  const fetchTickets = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (!silent) setLoading(true);
        const headers = { Authorization: `Bearer ${token}` };
        const response = await axios.get('/api/tickets', { headers });
        const payload = response.data;
        const nextTickets = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.items)
          ? payload.items
          : [];
        setTickets(nextTickets);
        setError('');
      } catch (err: any) {
        setError(err?.response?.data?.message || 'Fehler beim Laden der Tickets');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token]
  );

  const fetchHotspots = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      try {
        if (!silent) setHotspotsLoading(true);
        const headers = { Authorization: `Bearer ${token}` };
        const response = await axios.get('/api/admin/dashboard/analytics', {
          headers,
          params: { days: hotspotWindowDays },
        });
        const payload = response.data as AnalyticsHotspotResponse;
        const nextHotspots = Array.isArray(payload?.mapHotspots)
          ? payload.mapHotspots
              .map((entry) => ({
                latitude: Number(entry?.latitude),
                longitude: Number(entry?.longitude),
                count: Number(entry?.count) || 0,
              }))
              .filter((entry) => Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude) && entry.count > 0)
          : [];
        setHotspots(nextHotspots.slice(0, 150));
      } catch {
        setHotspots([]);
      } finally {
        if (!silent) setHotspotsLoading(false);
      }
    },
    [hotspotWindowDays, token]
  );

  const refreshMapData = useCallback(
    async (options?: { silent?: boolean }) => {
      await fetchTickets(options);
      if (showHotspots) {
        await fetchHotspots(options);
      }
    },
    [fetchHotspots, fetchTickets, showHotspots]
  );

  const liveRefresh = useSmartTableLiveRefresh({
    token,
    config: {
      enabled: true,
      mode: 'hybrid',
      topics: ['tickets', 'workflows'],
      pollIntervalMsVisible: 30000,
      pollIntervalMsHidden: 120000,
      debounceMs: 150,
      refetchOnFocus: true,
      staleAfterMs: 180000,
    },
    refresh: (options) => refreshMapData(options),
  });

  useEffect(() => {
    void refreshMapData();
  }, [refreshMapData]);

  useEffect(() => {
    if (showHotspots) {
      void fetchHotspots({ silent: true });
    }
  }, [showHotspots, hotspotWindowDays, fetchHotspots]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      minZoom: 5,
    }).setView(GIS_DEFAULT_CENTER, GIS_DEFAULT_ZOOM);

    const baseLayers: Record<BaseLayerId, L.TileLayer> = {
      street: L.tileLayer(BASE_LAYER_CONFIG.street.url, BASE_LAYER_CONFIG.street.options),
      topo: L.tileLayer(BASE_LAYER_CONFIG.topo.url, BASE_LAYER_CONFIG.topo.options),
      imagery: L.tileLayer(BASE_LAYER_CONFIG.imagery.url, BASE_LAYER_CONFIG.imagery.options),
    };
    baseLayers.street.addTo(map);
    baseLayersRef.current = baseLayers;
    activeBaseLayerRef.current = baseLayers.street;

    markerLayerRef.current = L.layerGroup().addTo(map);
    selectionLayerRef.current = L.layerGroup().addTo(map);
    hotspotLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const syncViewport = () => {
      const bounds = map.getBounds();
      setMapZoom(map.getZoom());
      setMapViewport({
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      });
    };

    setMapReady(true);
    syncViewport();

    const handleZoom = () => syncViewport();
    const handleMoveEnd = () => syncViewport();

    map.on('zoomend', handleZoom);
    map.on('moveend', handleMoveEnd);
    map.on('movestart', () => {
      if (hasAutoFittedRef.current) {
        userMovedMapRef.current = true;
      }
    });

    const handleMapClick = (event: L.LeafletMouseEvent) => {
      if (!selectionLayerRef.current) return;
      const currentMode = selectionModeRef.current;

      if (currentMode === 'rectangle') {
        if (!rectangleStartRef.current) {
          rectangleStartRef.current = event.latlng;
          setRectanglePending(true);
          setSelectionHint('Zweiten Punkt klicken, um Rechteckselektion abzuschließen.');
          return;
        }

        const start = rectangleStartRef.current;
        const bounds = L.latLngBounds(start, event.latlng);
        rectangleStartRef.current = null;
        setRectanglePending(false);
        selectionLayerRef.current.clearLayers();
        L.rectangle(bounds, {
          color: '#00457c',
          weight: 2,
          fillColor: '#60a5fa',
          fillOpacity: 0.15,
        }).addTo(selectionLayerRef.current);

        const ids = mappedTicketsRef.current
          .filter((ticket) => bounds.contains([Number(ticket.latitude), Number(ticket.longitude)]))
          .map((ticket) => ticket.id);
        setSelectedIds(ids);
        setSelectionHint(`${ids.length} Ticket(s) im Rechteck ausgewählt.`);
        return;
      }

      if (currentMode === 'polygon') {
        polygonDraftRef.current = [...polygonDraftRef.current, event.latlng];
        setPolygonPointCount(polygonDraftRef.current.length);
        selectionLayerRef.current.clearLayers();
        if (polygonDraftRef.current.length === 1) {
          L.circleMarker(event.latlng, { radius: 5, color: '#00457c', fillOpacity: 1 }).addTo(selectionLayerRef.current);
          setSelectionHint('Weitere Punkte setzen. Mit "Polygon abschließen" auswerten.');
        } else {
          const polyline = L.polyline(polygonDraftRef.current, {
            color: '#00457c',
            weight: 2,
            dashArray: '5 4',
          });
          polyline.addTo(selectionLayerRef.current);
          polygonDraftRef.current.forEach((point) => {
            L.circleMarker(point, { radius: 4, color: '#00457c', fillOpacity: 1 }).addTo(selectionLayerRef.current!);
          });
          setSelectionHint(`${polygonDraftRef.current.length} Punkte gesetzt.`);
        }
      }
    };

    map.on('click', handleMapClick);

    return () => {
      markerLayerRef.current?.clearLayers();
      selectionLayerRef.current?.clearLayers();
      hotspotLayerRef.current?.clearLayers();
      map.off('zoomend', handleZoom);
      map.off('moveend', handleMoveEnd);
      map.off('click', handleMapClick);
      map.off('movestart');
      map.remove();
      markerLayerRef.current = null;
      selectionLayerRef.current = null;
      hotspotLayerRef.current = null;
      mapRef.current = null;
      baseLayersRef.current = null;
      activeBaseLayerRef.current = null;
      markerByTicketRef.current.clear();
      setMapReady(false);
      rectangleStartRef.current = null;
      polygonDraftRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !baseLayersRef.current) return;
    const nextLayer = baseLayersRef.current[baseLayerId];
    if (!nextLayer) return;
    if (activeBaseLayerRef.current === nextLayer) return;

    if (activeBaseLayerRef.current) {
      mapRef.current.removeLayer(activeBaseLayerRef.current);
    }
    nextLayer.addTo(mapRef.current);
    activeBaseLayerRef.current = nextLayer;
  }, [baseLayerId]);

  const categories = useMemo(() => {
    const values = Array.from(new Set(tickets.map((ticket) => (ticket.category || '').trim()).filter(Boolean)));
    return values.sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
  }, [tickets]);

  const filteredWithoutMapConstraint = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tickets
      .filter((ticket) => {
        if (statusFilter !== 'all' && ticket.status !== statusFilter) return false;
        if (categoryFilter !== 'all' && ticket.category !== categoryFilter) return false;
        if (priorityFilter !== 'all' && ticket.priority !== priorityFilter) return false;
        if (workflowFilter === 'with' && !ticket.workflowStarted) return false;
        if (workflowFilter === 'without' && ticket.workflowStarted) return false;
        if (
          workflowFilter !== 'all' &&
          workflowFilter !== 'with' &&
          workflowFilter !== 'without' &&
          ticket.workflowStatus !== workflowFilter
        ) {
          return false;
        }

        if (!term) return true;

        const haystack = [
          ticket.id,
          ticket.citizenName || '',
          ticket.citizenEmail || '',
          ticket.category,
          ticket.status,
          ticket.priority,
          ticket.workflowStatus || '',
          ticket.address || '',
          ticket.postalCode || '',
          ticket.city || '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => parseDate(b.createdAt) - parseDate(a.createdAt));
  }, [tickets, search, statusFilter, categoryFilter, priorityFilter, workflowFilter]);

  const filteredTickets = useMemo(() => {
    return filteredWithoutMapConstraint.filter((ticket) => {
      if (onlyMapped && !hasCoordinates(ticket)) return false;
      if (limitToViewport && mapViewport) {
        return isTicketInsideViewport(ticket, mapViewport);
      }
      return true;
    });
  }, [filteredWithoutMapConstraint, onlyMapped, limitToViewport, mapViewport]);

  const mappedTickets = useMemo(() => filteredTickets.filter(hasCoordinates), [filteredTickets]);
  useEffect(() => {
    mappedTicketsRef.current = mappedTickets;
  }, [mappedTickets]);

  const unmappedTickets = useMemo(
    () => filteredWithoutMapConstraint.filter((ticket) => !hasCoordinates(ticket)).sort((a, b) => parseDate(b.createdAt) - parseDate(a.createdAt)),
    [filteredWithoutMapConstraint]
  );

  useEffect(() => {
    const allowed = new Set(filteredTickets.map((ticket) => ticket.id));
    setSelectedIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [filteredTickets]);

  const unmappedCount = Math.max(0, filteredTickets.length - mappedTickets.length);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const clusters = useMemo(() => clusterTickets(mappedTickets, mapZoom), [mappedTickets, mapZoom]);

  const markerDatasetKey = useMemo(
    () =>
      `${clusters
        .map((cluster) => `${cluster.id}:${cluster.latitude}:${cluster.longitude}:${cluster.tickets.length}`)
        .join('|')}::${selectedIds.slice().sort().join('|')}`,
    [clusters, selectedIds]
  );

  useEffect(() => {
    if (!mapReady || !mapRef.current || !markerLayerRef.current) return;
    const layer = markerLayerRef.current;
    const map = mapRef.current;
    layer.clearLayers();
    markerByTicketRef.current = new Map();

    if (clusters.length === 0) return;

    const bounds = L.latLngBounds([]);
    const adminBase = window.location.pathname.startsWith('/admin') ? '/admin' : '';

    clusters.forEach((cluster) => {
      const { latitude, longitude, tickets: groupedTickets } = cluster;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const isSingle = groupedTickets.length === 1;
      let marker: L.Layer;

      if (isSingle) {
        const ticket = groupedTickets[0];
        const status = ticket.status;
        const statusLabel = STATUS_LABELS[status] || status;
        const priorityLabel = PRIORITY_LABELS[ticket.priority] || ticket.priority;
        const workflowLabel = ticket.workflowStatus
          ? WORKFLOW_STATUS_LABELS[ticket.workflowStatus] || ticket.workflowStatus
          : '–';
        const locationLabel = formatLocation(ticket);
        const reporterLabel = ticket.citizenName || ticket.citizenEmail || '–';
        const detailPath = `${adminBase}/tickets/${encodeURIComponent(ticket.id)}`;
        const isSelected = selectedIdSet.has(ticket.id);
        const markerColor = statusColor(status);

        const circle = L.circleMarker([latitude, longitude], {
          radius: isSelected ? 10 : 8,
          color: markerColor,
          weight: isSelected ? 3 : 2,
          fillColor: markerColor,
          fillOpacity: isSelected ? 0.48 : 0.28,
        });

        circle.bindTooltip(
          `<div class="ticket-map-tooltip"><strong>${escapeHtml(ticket.id)}</strong><br>${escapeHtml(
            ticket.category || '–'
          )}<br>${escapeHtml(reporterLabel)}<br>Status: ${escapeHtml(statusLabel)} · Priorität: ${escapeHtml(priorityLabel)}</div>`,
          { direction: 'top', offset: [0, -10], sticky: true, opacity: 0.95 }
        );

        circle.bindPopup(
          `<div class="ticket-map-popup">
            <h4>${escapeHtml(ticket.category || 'Ticket')}</h4>
            <div class="ticket-map-popup-line"><strong>ID:</strong> ${escapeHtml(ticket.id)}</div>
            <div class="ticket-map-popup-line"><strong>Status:</strong> ${escapeHtml(statusLabel)}</div>
            <div class="ticket-map-popup-line"><strong>Priorität:</strong> ${escapeHtml(priorityLabel)}</div>
            <div class="ticket-map-popup-line"><strong>Meldende Person:</strong> ${escapeHtml(reporterLabel)}</div>
            <div class="ticket-map-popup-line"><strong>Workflow:</strong> ${escapeHtml(workflowLabel)}</div>
            <div class="ticket-map-popup-line"><strong>Ort:</strong> ${escapeHtml(locationLabel)}</div>
            <div class="ticket-map-popup-line"><strong>Koordinaten:</strong> ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}</div>
            <a class="ticket-map-popup-link" href="${detailPath}">Ticket öffnen</a>
          </div>`
        );

        markerByTicketRef.current.set(ticket.id, circle);
        marker = circle;
      } else {
        const statusCount = groupedTickets.reduce<Record<string, number>>((acc, ticket) => {
          acc[ticket.status] = (acc[ticket.status] || 0) + 1;
          return acc;
        }, {});
        const dominantStatus = Object.entries(statusCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'open';
        const color = statusColor(dominantStatus);
        const icon = L.divIcon({
          className: 'ticket-map-cluster-icon',
          html: `<span style="background:${color}">${groupedTickets.length}</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const clusterMarker = L.marker([latitude, longitude], { icon });
        const previewItems = groupedTickets
          .slice(0, 6)
          .map((ticket) => `<li><strong>${escapeHtml(ticket.id.slice(0, 8))}</strong> · ${escapeHtml(ticket.category || '–')}</li>`)
          .join('');
        const moreCount = Math.max(0, groupedTickets.length - 6);

        clusterMarker.bindPopup(
          `<div class="ticket-map-popup">
             <h4>Cluster mit ${groupedTickets.length} Tickets</h4>
             <div class="ticket-map-popup-line"><strong>Status-Mix:</strong> ${Object.entries(statusCount)
               .map(([status, count]) => `${escapeHtml(STATUS_LABELS[status] || status)} (${count})`)
               .join(', ')}</div>
             <ul class="ticket-map-cluster-list">${previewItems}</ul>
             ${moreCount > 0 ? `<div class="ticket-map-popup-line">+${moreCount} weitere…</div>` : ''}
             <div class="ticket-map-popup-line">Zoom erhöht die Detailauflösung.</div>
           </div>`
        );

        clusterMarker.on('click', () => {
          if (map.getZoom() < 16) {
            map.setView([latitude, longitude], Math.min(16, map.getZoom() + 2), { animate: true });
          }
        });

        marker = clusterMarker;
      }

      marker.addTo(layer);
      bounds.extend([latitude, longitude]);
    });

    if (bounds.isValid()) {
      if (!hasAutoFittedRef.current || !userMovedMapRef.current) {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
        hasAutoFittedRef.current = true;
      }
    }
  }, [clusters, mapReady, markerDatasetKey, selectedIdSet]);

  useEffect(() => {
    if (!mapReady || !hotspotLayerRef.current) return;
    const layer = hotspotLayerRef.current;
    layer.clearLayers();

    if (!showHotspots || hotspots.length === 0) return;

    hotspots.forEach((hotspot) => {
      const radius = Math.min(24, 5 + Math.sqrt(hotspot.count) * 2.4);
      const fillOpacity = Math.min(0.72, 0.22 + hotspot.count / 40);
      const marker = L.circleMarker([hotspot.latitude, hotspot.longitude], {
        radius,
        color: '#9a3412',
        weight: 1.4,
        fillColor: '#f97316',
        fillOpacity,
      });
      marker.bindTooltip(`${hotspot.count} Tickets`, { direction: 'top', opacity: 0.95 });
      marker.bindPopup(
        `<div class="ticket-map-popup">
          <h4>Hotspot</h4>
          <div class="ticket-map-popup-line"><strong>Tickets:</strong> ${hotspot.count}</div>
          <div class="ticket-map-popup-line"><strong>Koordinaten:</strong> ${hotspot.latitude.toFixed(4)}, ${hotspot.longitude.toFixed(4)}</div>
          <div class="ticket-map-popup-line">Zeitraum: letzte ${hotspotWindowDays} Tage</div>
        </div>`
      );
      marker.addTo(layer);
    });
  }, [hotspotWindowDays, hotspots, mapReady, showHotspots]);

  const clearDrawGeometry = () => {
    rectangleStartRef.current = null;
    polygonDraftRef.current = [];
    setRectanglePending(false);
    setPolygonPointCount(0);
    selectionLayerRef.current?.clearLayers();
  };

  const clearAllSelection = () => {
    clearDrawGeometry();
    setSelectedIds([]);
    setSelectionHint('');
  };

  const toggleSelectionMode = (mode: SelectionMode) => {
    clearDrawGeometry();
    setSelectionMode((prev) => (prev === mode ? 'none' : mode));
    setSelectionHint('');
  };

  const finalizePolygonSelection = () => {
    if (polygonDraftRef.current.length < 3 || !selectionLayerRef.current) {
      setSelectionHint('Für Polygon-Selektion sind mindestens 3 Punkte nötig.');
      return;
    }

    const points = polygonDraftRef.current.map((point) => ({ lat: point.lat, lon: point.lng }));
    selectionLayerRef.current.clearLayers();
    L.polygon(polygonDraftRef.current, {
      color: '#00457c',
      weight: 2,
      fillColor: '#60a5fa',
      fillOpacity: 0.15,
    }).addTo(selectionLayerRef.current);

    const ids = mappedTicketsRef.current
      .filter((ticket) => isPointInsidePolygon(Number(ticket.latitude), Number(ticket.longitude), points))
      .map((ticket) => ticket.id);
    setSelectedIds(ids);
    setSelectionHint(`${ids.length} Ticket(s) im Polygon ausgewählt.`);
    polygonDraftRef.current = [];
    setPolygonPointCount(0);
  };

  const zoomToTickets = (ticketList: Ticket[], options?: { markUserMove?: boolean }) => {
    if (!mapRef.current) return;
    const points = ticketList
      .filter(hasCoordinates)
      .map((ticket) => [Number(ticket.latitude), Number(ticket.longitude)] as [number, number]);

    if (points.length === 0) {
      mapRef.current.setView(GIS_DEFAULT_CENTER, GIS_DEFAULT_ZOOM, { animate: true });
      setSelectionHint('Keine Tickets mit Koordinaten verfügbar.');
      return;
    }

    const bounds = L.latLngBounds(points);
    mapRef.current.fitBounds(bounds, { padding: [42, 42], maxZoom: 16 });
    if (options?.markUserMove !== false) {
      userMovedMapRef.current = true;
    }
  };

  const focusSelectionOnMap = () => {
    const selectedTickets = filteredTickets.filter((ticket) => selectedIdSet.has(ticket.id));
    zoomToTickets(selectedTickets);
  };

  const focusFilteredOnMap = () => {
    zoomToTickets(mappedTickets);
  };

  const resetMapView = () => {
    hasAutoFittedRef.current = false;
    userMovedMapRef.current = false;
    zoomToTickets(mappedTickets, { markUserMove: false });
  };

  const focusTicketOnMap = (ticket: Ticket) => {
    if (!mapRef.current || !hasCoordinates(ticket)) return;
    const lat = Number(ticket.latitude);
    const lon = Number(ticket.longitude);
    mapRef.current.setView([lat, lon], Math.max(16, mapRef.current.getZoom()), { animate: true });
    window.setTimeout(() => {
      const marker = markerByTicketRef.current.get(ticket.id) as { openPopup?: () => void } | undefined;
      marker?.openPopup?.();
    }, 280);
    setSelectionHint(`Ticket ${ticket.id.slice(0, 8)} auf Karte fokussiert.`);
  };

  const handleBulkApply = async () => {
    if (selectedIds.length === 0) {
      setError('Bitte zuerst Tickets auswählen.');
      return;
    }
    if (!bulkReason.trim()) {
      setError('Bitte einen Grund für die Bulk-Aktion angeben.');
      return;
    }

    const patch: Record<string, any> = {};
    if (bulkStatus) patch.status = bulkStatus;
    if (bulkPriority) patch.priority = bulkPriority;
    if (bulkWorkflow) {
      patch.startWorkflow = true;
      if (bulkWorkflowTemplateId.trim()) {
        patch.workflowTemplateId = bulkWorkflowTemplateId.trim();
      }
    }

    if (Object.keys(patch).length === 0) {
      setError('Bitte mindestens eine Bulk-Änderung auswählen.');
      return;
    }

    setBulkLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.patch(
        '/api/tickets/bulk',
        {
          ids: selectedIds,
          patch,
          reason: bulkReason.trim(),
        },
        { headers }
      );

      const updated = Number(response.data?.updated || 0);
      const failed = Number(response.data?.failed || 0);
      setError('');
      setSelectionHint(`Bulk abgeschlossen: ${updated} aktualisiert, ${failed} fehlgeschlagen.`);
      setSelectedIds([]);
      setBulkReason('');
      setBulkStatus('');
      setBulkPriority('');
      setBulkWorkflow(false);
      setBulkWorkflowTemplateId('');
      await refreshMapData({ silent: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Bulk-Aktion fehlgeschlagen');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleGeocodeTicket = async (ticketId: string) => {
    setQueueBusyByTicket((prev) => ({ ...prev, [ticketId]: true }));
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await axios.post(`/api/admin/tickets/${ticketId}/geocode`, {}, { headers });
      setSelectionHint(`Ticket ${ticketId.slice(0, 8)} wurde geocodiert.`);
      await refreshMapData({ silent: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Geocoding fehlgeschlagen');
    } finally {
      setQueueBusyByTicket((prev) => ({ ...prev, [ticketId]: false }));
    }
  };

  const geocodeBatchCandidates = useMemo(() => unmappedTickets.slice(0, 15), [unmappedTickets]);

  const handleGeocodeBatch = async () => {
    if (geocodeBatchCandidates.length === 0) {
      setSelectionHint('Keine Tickets ohne Koordinaten für den Batch vorhanden.');
      return;
    }
    if (!window.confirm(`${geocodeBatchCandidates.length} Ticket(s) jetzt geocodieren?`)) {
      return;
    }

    const ids = geocodeBatchCandidates.map((ticket) => ticket.id);
    setGeocodeBatchLoading(true);
    setQueueBusyByTicket((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = true;
      });
      return next;
    });

    try {
      const headers = { Authorization: `Bearer ${token}` };
      const results = await Promise.allSettled(
        ids.map((id) => axios.post(`/api/admin/tickets/${id}/geocode`, {}, { headers }))
      );
      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = ids.length - successCount;
      setSelectionHint(
        failedCount > 0
          ? `Batch-Geocoding: ${successCount} erfolgreich, ${failedCount} fehlgeschlagen.`
          : `Batch-Geocoding: ${successCount} erfolgreich.`
      );
      await refreshMapData({ silent: true });
    } catch {
      setError('Batch-Geocoding fehlgeschlagen');
    } finally {
      setQueueBusyByTicket((prev) => {
        const next = { ...prev };
        ids.forEach((id) => {
          next[id] = false;
        });
        return next;
      });
      setGeocodeBatchLoading(false);
    }
  };

  const resetFilters = () => {
    setStatusFilter('all');
    setCategoryFilter('all');
    setPriorityFilter('all');
    setWorkflowFilter('all');
    setSearch('');
    setOnlyMapped(true);
    setLimitToViewport(false);
    setSelectionHint('Filter zurückgesetzt.');
  };

  const ticketMapColumns = useMemo<SmartTableColumnDef<Ticket>[]>(
    () => [
      {
        field: 'id',
        headerName: 'Ticket',
        minWidth: 130,
        renderCell: (params) => <code className="ticket-id">{String(params.row.id || '').slice(0, 8)}</code>,
      },
      {
        field: 'category',
        headerName: 'Kategorie',
        minWidth: 220,
        flex: 1,
        renderCell: (params) => (
          <span className="smart-table-multiline-text">{params.row.category || '–'}</span>
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 170,
        renderCell: (params) => (
          <span className={`status-pill status-${params.row.status}`}>
            {STATUS_LABELS[params.row.status] || params.row.status}
          </span>
        ),
      },
      {
        field: 'priority',
        headerName: 'Priorität',
        minWidth: 130,
        valueGetter: (_value, row) => PRIORITY_LABELS[row.priority] || row.priority || '–',
      },
      {
        field: 'workflowStatus',
        headerName: 'Workflow',
        minWidth: 170,
        renderCell: (params) =>
          params.row.workflowStatus ? (
            <span className={`status-pill status-${String(params.row.workflowStatus).toLowerCase()}`}>
              {WORKFLOW_STATUS_LABELS[params.row.workflowStatus] || params.row.workflowStatus}
            </span>
          ) : (
            '–'
          ),
      },
      {
        field: 'reporter',
        headerName: 'Meldung von',
        minWidth: 220,
        flex: 1,
        valueGetter: (_value, row) => row.citizenName || row.citizenEmail || '–',
        renderCell: (params) => (
          <span className="smart-table-multiline-text">
            {params.row.citizenName || params.row.citizenEmail || '–'}
          </span>
        ),
      },
      {
        field: 'location',
        headerName: 'Ort',
        minWidth: 240,
        flex: 1,
        valueGetter: (_value, row) => formatLocation(row),
        renderCell: (params) => <span className="smart-table-multiline-text">{formatLocation(params.row)}</span>,
      },
      {
        field: 'coordinates',
        headerName: 'Koordinaten',
        minWidth: 210,
        valueGetter: (_value, row) =>
          hasCoordinates(row)
            ? `${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)}`
            : '–',
      },
      {
        field: 'primaryAssigneeUserId',
        headerName: 'Zugewiesen an (User)',
        minWidth: 200,
        defaultVisible: false,
        valueGetter: (_value, row) => row.primaryAssigneeUserId || '–',
      },
      {
        field: 'primaryAssigneeOrgUnitId',
        headerName: 'Zugewiesen an (Org)',
        minWidth: 200,
        defaultVisible: false,
        valueGetter: (_value, row) => row.primaryAssigneeOrgUnitId || '–',
      },
      {
        field: 'owningOrgUnitId',
        headerName: 'Owner-Organisation',
        minWidth: 210,
        defaultVisible: false,
        valueGetter: (_value, row) => row.owningOrgUnitId || '–',
      },
      {
        field: 'submissionId',
        headerName: 'Submission',
        minWidth: 190,
        defaultVisible: false,
        valueGetter: (_value, row) => row.submissionId || '–',
      },
      {
        field: 'createdAt',
        headerName: 'Erstellt',
        minWidth: 170,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'updatedAt',
        headerName: 'Aktualisiert',
        minWidth: 170,
        defaultVisible: false,
        valueFormatter: (value) => formatDateTime(String(value || '')),
      },
      {
        field: 'actions',
        headerName: 'Aktionen',
        minWidth: 132,
        sortable: false,
        filterable: false,
        hideable: false,
        disableColumnMenu: true,
        renderCell: (params) => (
          <SmartTableRowActions>
            <SmartTableRowActionButton
              label="Auf Karte fokussieren"
              icon={<RoomRoundedIcon fontSize="inherit" />}
              tone="primary"
              onClick={() => focusTicketOnMap(params.row)}
              disabled={!hasCoordinates(params.row)}
            />
            <SmartTableRowActionButton
              label="Ticket geocodieren"
              icon={<TravelExploreRoundedIcon fontSize="inherit" />}
              tone="warning"
              loading={queueBusyByTicket[params.row.id]}
              onClick={() => {
                void handleGeocodeTicket(params.row.id);
              }}
              disabled={hasCoordinates(params.row)}
            />
            <SmartTableRowActionButton
              label="Details öffnen"
              icon={<OpenInNewRoundedIcon fontSize="inherit" />}
              onClick={() => {
                navigate(`/tickets/${params.row.id}`);
              }}
            />
          </SmartTableRowActions>
        ),
      },
    ],
    [focusTicketOnMap, handleGeocodeTicket, navigate, queueBusyByTicket]
  );

  return (
    <Box className="ticket-map-page">
      <Paper variant="outlined" className="ticket-map-header-shell">
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1.2}>
          <Box>
            <Typography className="ticket-map-kicker">GIS Workspace</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Karte/GIS
            </Typography>
            <Typography variant="body2" className="ticket-map-subtitle">
              Live-Lagebild mit Clustering, GIS-Layern, Flächenselektion und SmartTable-Steuerung.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              size="small"
              variant="contained"
              startIcon={<RefreshRoundedIcon />}
              onClick={() => {
                void liveRefresh.refreshNow();
              }}
              disabled={loading || liveRefresh.isRefreshing}
            >
              {loading || liveRefresh.isRefreshing ? 'Aktualisiert…' : 'Aktualisieren'}
            </Button>
            <Button size="small" variant="outlined" startIcon={<FilterAltOffRoundedIcon />} onClick={resetFilters}>
              Filter zurücksetzen
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}

      <Paper variant="outlined" className="ticket-map-filters-panel">
        <Stack direction="row" spacing={1.2} useFlexGap flexWrap="wrap" sx={{ p: 1.2 }}>
          <TextField
            size="small"
            label="Suche"
            placeholder="Ticket, Meldender, Kategorie, Status, Ort ..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ minWidth: 260, flex: '1 1 320px' }}
          />
          <TextField
            select
            size="small"
            label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="all">Alle Status</MenuItem>
            {Object.keys(STATUS_LABELS).map((status) => (
              <MenuItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Kategorie"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            sx={{ minWidth: 190 }}
          >
            <MenuItem value="all">Alle Kategorien</MenuItem>
            {categories.map((category) => (
              <MenuItem key={category} value={category}>
                {category}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Priorität"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="all">Alle Prioritäten</MenuItem>
            {Object.keys(PRIORITY_LABELS).map((priority) => (
              <MenuItem key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Workflow"
            value={workflowFilter}
            onChange={(event) => setWorkflowFilter(event.target.value as WorkflowFilter)}
            sx={{ minWidth: 190 }}
          >
            <MenuItem value="all">Alle</MenuItem>
            <MenuItem value="with">Nur mit Workflow</MenuItem>
            <MenuItem value="without">Nur ohne Workflow</MenuItem>
            <MenuItem value="RUNNING">Workflow läuft</MenuItem>
            <MenuItem value="PAUSED">Workflow pausiert</MenuItem>
            <MenuItem value="COMPLETED">Workflow abgeschlossen</MenuItem>
            <MenuItem value="FAILED">Workflow Fehler</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Basiskarte"
            value={baseLayerId}
            onChange={(event) => setBaseLayerId(event.target.value as BaseLayerId)}
            sx={{ minWidth: 170 }}
          >
            {BASE_LAYER_OPTIONS.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Hotspot-Zeitraum"
            value={hotspotWindowDays}
            onChange={(event) => setHotspotWindowDays(Number(event.target.value) as HotspotWindowDays)}
            disabled={!showHotspots}
            sx={{ minWidth: 170 }}
          >
            {HOTSPOT_WINDOW_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={0.6} flexWrap="wrap" className="ticket-map-switch-row">
            <FormControlLabel
              control={
                <Switch
                  id="map-only-mapped"
                  checked={onlyMapped}
                  onChange={(event) => setOnlyMapped(event.target.checked)}
                />
              }
              label="Nur Tickets mit Koordinaten"
            />
            <FormControlLabel
              control={
                <Switch
                  id="map-limit-viewport"
                  checked={limitToViewport}
                  onChange={(event) => setLimitToViewport(event.target.checked)}
                />
              }
              label="Nur Kartenausschnitt"
            />
            <FormControlLabel
              control={
                <Switch
                  id="map-hotspots"
                  checked={showHotspots}
                  onChange={(event) => setShowHotspots(event.target.checked)}
                />
              }
              label="Hotspot-Overlay"
            />
          </Stack>
        </Stack>
      </Paper>

      <Stack direction="row" spacing={0.8} className="ticket-map-stats" useFlexGap flexWrap="wrap">
        <Chip size="small" label={`Gesamt: ${tickets.length}`} />
        <Chip size="small" label={`Gefiltert: ${filteredTickets.length}`} />
        <Chip size="small" label={`Auf Karte: ${mappedTickets.length}`} />
        <Chip size="small" label={`Auswahl: ${selectedIds.length}`} />
        <Chip size="small" label={`Zoom: ${mapZoom}`} />
        {unmappedCount > 0 && <Chip size="small" label={`Ohne Koordinaten: ${unmappedCount}`} />}
        {limitToViewport && <Chip size="small" color="primary" label="Kartenausschnitt aktiv" />}
        {showHotspots && (
          <Chip
            size="small"
            color="warning"
            label={`Hotspots: ${hotspots.length}${hotspotsLoading ? ' (aktualisiert...)' : ''}`}
          />
        )}
      </Stack>

      <div className="ticket-map-layout">
        <div className="ticket-map-main-col">
          <Paper variant="outlined" className="ticket-map-tools">
            <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" alignItems="center">
              <Button
                size="small"
                variant={selectionMode === 'rectangle' ? 'contained' : 'outlined'}
                startIcon={<CropSquareRoundedIcon />}
                onClick={() => toggleSelectionMode('rectangle')}
              >
                Rechteck{rectanglePending ? ' · Punkt 2' : ''}
              </Button>
              <Button
                size="small"
                variant={selectionMode === 'polygon' ? 'contained' : 'outlined'}
                startIcon={<PolylineRoundedIcon />}
                onClick={() => toggleSelectionMode('polygon')}
              >
                Polygon{selectionMode === 'polygon' ? ` · ${polygonPointCount}` : ''}
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DoneRoundedIcon />}
                onClick={finalizePolygonSelection}
                disabled={selectionMode !== 'polygon' || polygonPointCount < 3}
              >
                Polygon abschließen
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CenterFocusStrongRoundedIcon />}
                onClick={focusSelectionOnMap}
                disabled={selectedIds.length === 0}
              >
                Auswahl zoomen
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ZoomOutMapRoundedIcon />}
                onClick={focusFilteredOnMap}
                disabled={mappedTickets.length === 0}
              >
                Gefilterte zoomen
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<RestartAltRoundedIcon />}
                onClick={resetMapView}
                disabled={mappedTickets.length === 0}
              >
                Ansicht reset
              </Button>
              <Button size="small" variant="outlined" startIcon={<BackspaceRoundedIcon />} onClick={clearAllSelection}>
                Auswahl löschen
              </Button>
              {selectionHint && (
                <Chip size="small" color="info" variant="outlined" label={selectionHint} className="ticket-map-selection-chip" />
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" className="ticket-map-card">
            <div className="ticket-map-card-top">
              <div className="ticket-map-legend">
                <span><i className="ticket-map-status-dot is-pending_validation" /> Validierung</span>
                <span><i className="ticket-map-status-dot is-open" /> Offen</span>
                <span><i className="ticket-map-status-dot is-in-progress" /> In Bearbeitung</span>
                <span><i className="ticket-map-status-dot is-completed" /> Abgeschlossen</span>
                <span><i className="ticket-map-status-dot is-closed" /> Geschlossen</span>
                {showHotspots && <span><i className="ticket-map-status-dot is-hotspot" /> Hotspots</span>}
              </div>
              <div className="ticket-map-card-note">Cluster werden bei niedriger Zoomstufe zusammengefasst.</div>
            </div>
            <div ref={mapContainerRef} className="ticket-map-canvas" />
          </Paper>

          {mappedTickets.length === 0 && !loading && (
            <Alert severity="info">Keine Tickets mit Koordinaten für die aktuelle Filterung gefunden.</Alert>
          )}
        </div>

        <aside className="ticket-map-side-col">
          <Paper variant="outlined" className="ticket-map-side-card">
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Bulk-Aktionen
            </Typography>
            <Typography variant="body2">{selectedIds.length} Ticket(s) ausgewählt.</Typography>
            <TextField
              select
              size="small"
              label="Status setzen (optional)"
              value={bulkStatus}
              onChange={(event) => setBulkStatus(event.target.value)}
            >
              <MenuItem value="">Unverändert</MenuItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Priorität setzen (optional)"
              value={bulkPriority}
              onChange={(event) => setBulkPriority(event.target.value)}
            >
              <MenuItem value="">Unverändert</MenuItem>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={<Switch checked={bulkWorkflow} onChange={(event) => setBulkWorkflow(event.target.checked)} />}
              label="Workflow starten"
            />
            {bulkWorkflow && (
              <TextField
                size="small"
                label="Workflow-Vorlage (optional)"
                value={bulkWorkflowTemplateId}
                onChange={(event) => setBulkWorkflowTemplateId(event.target.value)}
                placeholder="z. B. standard-redmine-ticket"
              />
            )}
            <TextField
              multiline
              minRows={3}
              label="Grund (Pflicht)"
              value={bulkReason}
              onChange={(event) => setBulkReason(event.target.value)}
              placeholder="Warum wird diese Sammelaktion ausgeführt?"
            />
            <Button type="button" variant="contained" onClick={handleBulkApply} disabled={bulkLoading}>
              {bulkLoading ? 'Wird ausgeführt…' : 'Bulk anwenden'}
            </Button>
          </Paper>

          <Paper variant="outlined" className="ticket-map-side-card">
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Ohne Koordinaten
            </Typography>
            <Typography variant="body2">{unmappedTickets.length} Ticket(s) im aktuellen Filter ohne Geodaten.</Typography>
            <Button
              type="button"
              variant="outlined"
              onClick={handleGeocodeBatch}
              disabled={geocodeBatchLoading || geocodeBatchCandidates.length === 0}
            >
              {geocodeBatchLoading ? 'Batch läuft…' : `Batch-Geocode (max ${geocodeBatchCandidates.length})`}
            </Button>
            {unmappedTickets.length === 0 ? (
              <Typography variant="body2">Alle gefilterten Tickets haben Koordinaten.</Typography>
            ) : (
              <div className="ticket-map-unmapped-list">
                {unmappedTickets.slice(0, 25).map((ticket) => (
                  <div key={ticket.id} className="ticket-map-unmapped-item">
                    <div>
                      <div className="ticket-map-unmapped-id">{ticket.id.slice(0, 8)}</div>
                      <div className="ticket-map-unmapped-title">{ticket.category || 'Ticket'}</div>
                      <div className="ticket-map-unmapped-meta">{formatLocation(ticket)}</div>
                    </div>
                    <div className="ticket-map-unmapped-actions">
                      <Button
                        type="button"
                        variant="outlined"
                        size="small"
                        disabled={queueBusyByTicket[ticket.id]}
                        onClick={() => {
                          void handleGeocodeTicket(ticket.id);
                        }}
                      >
                        {queueBusyByTicket[ticket.id] ? '…' : 'Geocode'}
                      </Button>
                      <Link className="ticket-map-detail-link" to={`/tickets/${ticket.id}`}>
                        Details
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Paper>
        </aside>
      </div>

      <SmartTable<Ticket>
        tableId="ticket-map-tickets"
        userId="map"
        title="Tickets im Kartenkontext"
        rows={filteredTickets}
        columns={ticketMapColumns}
        loading={loading}
        error={error}
        checkboxSelection
        selectionModel={selectedIds}
        onSelectionModelChange={(ids) => setSelectedIds(ids)}
        onRowClick={(row) => {
          if (hasCoordinates(row)) {
            focusTicketOnMap(row);
          }
        }}
        onRefresh={() => liveRefresh.refreshNow()}
        liveState={liveRefresh.liveState}
        lastEventAt={liveRefresh.lastEventAt}
        lastSyncAt={liveRefresh.lastSyncAt}
        isRefreshing={liveRefresh.isRefreshing}
        toolbarStartActions={<Chip size="small" label={`Auf Karte: ${mappedTickets.length}`} />}
        toolbarEndActions={
          <Chip
            size="small"
            icon={<MyLocationRoundedIcon />}
            label={`Ohne Koordinaten: ${unmappedTickets.length}`}
            variant="outlined"
          />
        }
      />
    </Box>
  );
};

export default TicketMap;
