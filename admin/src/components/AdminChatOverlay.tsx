import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { client as createXmppClient, xml } from '@xmpp/client';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  Fab,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import LinkIcon from '@mui/icons-material/Link';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DoneIcon from '@mui/icons-material/Done';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import AddReactionIcon from '@mui/icons-material/AddReaction';
import InsertEmoticonIcon from '@mui/icons-material/InsertEmoticon';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ViewListIcon from '@mui/icons-material/ViewList';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import FilterNoneIcon from '@mui/icons-material/FilterNone';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import HistoryIcon from '@mui/icons-material/History';
import CallIcon from '@mui/icons-material/Call';
import CallEndIcon from '@mui/icons-material/CallEnd';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import BugReportIcon from '@mui/icons-material/BugReport';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';

interface AdminChatOverlayProps {
  token: string;
  embedded?: boolean;
  hideLauncher?: boolean;
}

interface ChatContact {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: string;
  jid: string;
}

interface ChatGroupMember {
  adminUserId: string;
  role: string;
  displayName: string;
}

interface ChatGroup {
  id: string;
  customGroupId?: string;
  type: 'org' | 'custom';
  name: string;
  tenantId?: string | null;
  orgUnitId?: string;
  roomJid: string;
  members?: ChatGroupMember[];
  createdByAdminId?: string;
  canManageDelete?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface ChatQuote {
  messageId?: string | null;
  body: string;
  senderDisplayName?: string;
}

interface ChatReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  reactors?: string[];
}

interface ChatDirectoryOrgUnit {
  id: string;
  tenantId?: string;
  tenantName?: string;
  parentId?: string | null;
  name: string;
}

interface ChatDirectoryContactScope {
  contactId: string;
  tenantId?: string;
  tenantName?: string;
  orgUnitId: string;
  orgUnitName?: string;
  canWrite?: boolean;
}

interface ChatBootstrap {
  enabled: boolean;
  features?: {
    multiClientSync?: boolean;
    firstCatchRouting?: boolean;
    presenceHybrid?: boolean;
  };
  connection?: {
    wsBoshFallback?: boolean;
  };
  xmpp: {
    domain: string;
    mucService: string;
    websocketUrl: string;
    jid: string;
    username: string;
    password: string;
    resource?: string;
    rtc?: {
      iceServers?: Array<{
        urls: string[] | string;
        username?: string;
        credential?: string;
      }>;
      bestEffortOnly?: boolean;
      turnConfigured?: boolean;
      reliabilityHints?: string[];
    };
  };
  calls?: {
    enabled?: boolean;
    routingMode?: 'parallel_first_accept' | string;
    policyReason?: string;
    media?: {
      audio?: boolean;
      video?: boolean;
      upgradeSupported?: boolean;
      directOnly?: boolean;
    };
  };
  me: {
    id: string;
    username: string;
    displayName: string;
    email: string;
  };
  settings: {
    emailNotificationsDefault: boolean;
    presence?: {
      status?: 'online' | 'away' | 'offline' | 'dnd' | 'custom';
      label?: string;
      color?: string;
      emoji?: string;
      expiresAt?: string | null;
      updatedAt?: string | null;
    };
  };
  assistant?: {
    enabled?: boolean;
    conversationId?: string;
    displayName?: string;
    subtitle?: string;
    resetCommand?: string;
  };
  systemUser?: {
    enabled?: boolean;
    conversationId?: string;
    displayName?: string;
    subtitle?: string;
  };
  contacts: ChatContact[];
  directory?: {
    orgUnits?: ChatDirectoryOrgUnit[];
    contactScopes?: ChatDirectoryContactScope[];
  };
  groups: {
    org: ChatGroup[];
    custom: ChatGroup[];
  };
}

interface ChatFile {
  id: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  downloadUrl: string;
}

interface ChatMessage {
  id: string;
  senderAdminUserId: string;
  senderDisplayName: string;
  conversationId: string;
  messageKind: string;
  body: string;
  file?: ChatFile | null;
  ticketId?: string | null;
  xmppStanzaId?: string | null;
  quote?: ChatQuote | null;
  reactions?: ChatReaction[];
  createdAt?: string | null;
  optimistic?: boolean;
  readAtByMe?: string | null;
  deliveredByRecipientAt?: string | null;
  readByRecipientAt?: string | null;
  readByCount?: number;
}

type TabMode = 'direct' | 'group';
type ConnectionState = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'error';
type ChatConnectionHealthState = 'online' | 'degraded' | 'reconnecting' | 'fallback_bosh' | 'offline';
type ChatDisplayMode = 'drawer' | 'floating';
type PresenceState = 'online' | 'away' | 'dnd' | 'offline';
type ChatSelfStatusKey = 'online' | 'away' | 'offline' | 'dnd' | 'custom';
type CallMediaType = 'audio' | 'video';
type CallVideoState = 'off' | 'requesting' | 'on' | 'failed';

interface ChatSelfPresenceSettings {
  status: ChatSelfStatusKey;
  label: string;
  color: string;
  emoji: string;
  expiresAt: string | null;
}

interface ConversationEntry {
  id: string;
  label: string;
  subtitle: string;
  jid: string;
  type: 'direct' | 'group' | 'assistant' | 'system';
  contactId?: string;
}

type DirectDirectoryViewMode = 'list' | 'hierarchy';

interface DirectoryContactScopeEntry {
  contactId: string;
  orgUnitId: string;
  orgUnitName: string;
  tenantName: string;
  canWrite: boolean;
}

interface FloatingPosition {
  x: number;
  y: number;
}

type CallUiState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended' | 'failed';

interface ChatCallSession {
  callId: string;
  conversationId: string;
  targetJid: string;
  startedByMe: boolean;
  startedAt: number;
  state: CallUiState;
  mediaType: CallMediaType;
  requestedMediaType: CallMediaType;
  videoState: CallVideoState;
  clientConnectionId: string;
  upgradeAllowed: boolean;
}

interface PendingIncomingCall {
  callId: string;
  conversationId: string;
  fromJid: string;
  fromLabel: string;
  fromAdminUserId?: string;
  fromResource?: string;
  mediaType?: CallMediaType;
  createdAt: number;
}

interface CallDebugEntry {
  id: string;
  at: string;
  category: 'state' | 'status' | 'event' | 'error';
  message: string;
}

type SinkCapableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

const CHAT_UI_MODE_KEY = 'admin.chat.uiMode.v1';
const CHAT_FLOAT_POS_KEY = 'admin.chat.floatPos.v1';
const CHAT_BROWSER_NOTIFY_KEY = 'admin.chat.browserNotify.v1';
const CHAT_LIST_PANEL_OPEN_KEY = 'admin.chat.listPanelOpen.v1';
const CHAT_DIRECT_VIEW_MODE_KEY = 'admin.chat.directViewMode.v1';
const CHAT_CLIENT_ID_STORAGE_KEY = 'admin.chat.clientId.v1';
const CHAT_DIRECTORY_ROOT_KEY = '__root__';
const DEFAULT_AUDIO_OUTPUT_DEVICE_ID = 'default';
const CHAT_REFRESH_VISIBLE_MS = 5000;
const CHAT_REFRESH_HIDDEN_MS = 15000;
const CHAT_READ_SYNC_MIN_INTERVAL_MS = 1800;
const CHAT_PRESENCE_HEARTBEAT_VISIBLE_MS = 25000;
const CHAT_PRESENCE_HEARTBEAT_HIDDEN_MS = 70000;
const CHAT_PRESENCE_SNAPSHOT_VISIBLE_MS = 20000;
const CHAT_PRESENCE_SNAPSHOT_HIDDEN_MS = 90000;
const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 84;
const COMMON_CHAT_EMOJIS = ['👍', '❤️', '😂', '😮', '🎉', '🙏', '👀', '✅', '🚀', '🔥'];
const XMPP_NS_RECEIPTS = 'urn:xmpp:receipts';
const XMPP_NS_CHAT_MARKERS = 'urn:xmpp:chat-markers:0';
const XMPP_NS_CHAT_STATES = 'http://jabber.org/protocol/chatstates';
const XMPP_NS_FORWARD = 'urn:xmpp:forward:0';
const XMPP_NS_DELAY = 'urn:xmpp:delay';
const XMPP_NS_MAM = 'urn:xmpp:mam:2';
const XMPP_NS_CARBONS = 'urn:xmpp:carbons:2';
const XMPP_NS_DATAFORM = 'jabber:x:data';
const XMPP_NS_RSM = 'http://jabber.org/protocol/rsm';
const XMPP_NS_PING = 'urn:xmpp:ping';
const XMPP_NS_JMI = 'urn:xmpp:jingle-message:0';
const XMPP_NS_WEBRTC = 'urn:behebes:webrtc:1';
const XMPP_PING_INTERVAL_MS = 60000;
const XMPP_PING_TIMEOUT_MS = 12000;
const CALL_REMOTE_TRACK_TIMEOUT_MS = 12000;
const CALL_DEBUG_MAX_ENTRIES = 80;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function ensureChatClientId(storageKey: string): string {
  try {
    const existing = normalizeText(window.sessionStorage.getItem(storageKey))
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .slice(0, 40);
    if (existing) return existing;
    const next = `c${Math.random().toString(36).slice(2, 12)}`;
    window.sessionStorage.setItem(storageKey, next);
    return next;
  } catch {
    return `c${Math.random().toString(36).slice(2, 12)}`;
  }
}

function resolveXmppServiceUrl(value: unknown): string {
  const raw = normalizeText(value) || '/xmpp-websocket';
  const securePage = window.location.protocol === 'https:';
  const wsProtocol = securePage ? 'wss:' : 'ws:';

  if (/^wss?:\/\//i.test(raw)) {
    if (securePage && raw.toLowerCase().startsWith('ws://')) {
      return raw.replace(/^ws:\/\//i, 'wss://');
    }
    return raw;
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      parsed.protocol = wsProtocol;
      return parsed.toString();
    } catch {
      return raw.replace(/^https?:\/\//i, `${wsProtocol}//`);
    }
  }

  if (raw.startsWith('//')) {
    return `${wsProtocol}${raw}`;
  }
  if (raw.startsWith('/')) {
    return `${wsProtocol}//${window.location.host}${raw}`;
  }
  return `${wsProtocol}//${window.location.host}/${raw.replace(/^\/+/, '')}`;
}

function resolveXmppBoshFallbackUrl(websocketUrl: string): string {
  const wsUrl = normalizeText(websocketUrl);
  if (!wsUrl) return '';
  const securePage = window.location.protocol === 'https:';
  const httpProtocol = securePage ? 'https:' : 'http:';

  try {
    const parsed = new URL(wsUrl);
    parsed.protocol = httpProtocol;
    if (parsed.pathname.includes('/xmpp-websocket')) {
      parsed.pathname = parsed.pathname.replace('/xmpp-websocket', '/http-bind');
    } else if (!parsed.pathname.includes('/http-bind')) {
      parsed.pathname = '/http-bind';
    }
    return parsed.toString();
  } catch {
    if (wsUrl.startsWith('/')) {
      const path = wsUrl.includes('/xmpp-websocket') ? wsUrl.replace('/xmpp-websocket', '/http-bind') : '/http-bind';
      return `${httpProtocol}//${window.location.host}${path}`;
    }
    return `${httpProtocol}//${window.location.host}/http-bind`;
  }
}

function detectVideoInSdp(sdp: unknown): boolean {
  const normalized = String(sdp || '');
  return /\bm=video\b/i.test(normalized);
}

function compareLocaleText(a: string, b: string): number {
  return a.localeCompare(b, 'de', { sensitivity: 'base' });
}

function initialsFromName(name: string): string {
  const parts = normalizeText(name).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function formatTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatCallDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getStanzaTimestamp(stanza: any): string {
  const delay = stanza?.getChild?.('delay', 'urn:xmpp:delay');
  const delayedStamp = normalizeText(delay?.attrs?.stamp);
  if (delayedStamp) {
    const parsed = new Date(delayedStamp);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function getPresenceColor(state: PresenceState): string {
  if (state === 'online') return '#16a34a';
  if (state === 'away') return '#f59e0b';
  if (state === 'dnd') return '#ef4444';
  return '#64748b';
}

const SELF_STATUS_PRESETS: Record<
  Exclude<ChatSelfStatusKey, 'custom'>,
  { label: string; color: string; emoji: string; description: string; xmppShow?: 'away' | 'dnd' }
> = {
  online: { label: 'Online', color: '#16a34a', emoji: '🟢', description: 'Sofort erreichbar' },
  away: { label: 'Abwesend', color: '#f59e0b', emoji: '☕', description: 'Kurzzeitig nicht aktiv', xmppShow: 'away' },
  offline: { label: 'Offline', color: '#64748b', emoji: '⚫', description: 'Nicht verfügbar' },
  dnd: { label: 'Bitte nicht stören', color: '#ef4444', emoji: '⛔', description: 'Keine Unterbrechungen', xmppShow: 'dnd' },
};

const DEFAULT_SELF_PRESENCE: ChatSelfPresenceSettings = {
  status: 'online',
  label: '',
  color: SELF_STATUS_PRESETS.online.color,
  emoji: SELF_STATUS_PRESETS.online.emoji,
  expiresAt: null,
};

const PRESENCE_QUICK_EXPIRY_OPTIONS: Array<{ id: string; label: string; minutes: number | null }> = [
  { id: 'none', label: 'Kein Ablauf', minutes: null },
  { id: '30m', label: '30 Min', minutes: 30 },
  { id: '1h', label: '1 Std', minutes: 60 },
  { id: '4h', label: '4 Std', minutes: 240 },
  { id: '24h', label: '24 Std', minutes: 1440 },
];

const PRESENCE_EMOJI_SUGGESTIONS = ['🟢', '☕', '🎯', '🧠', '📞', '🏖️', '🚫', '🤝', '🚀', '✅'];

function sanitizePresenceColor(value: unknown, fallback: string): string {
  const normalized = normalizeText(value).toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(normalized)) return normalized;
  return fallback;
}

function resolvePresenceStateLabel(state: PresenceState): string {
  if (state === 'online') return 'Online';
  if (state === 'away') return 'Abwesend';
  if (state === 'dnd') return 'Bitte nicht stören';
  return 'Offline';
}

function normalizeSelfPresenceFromPayload(
  payload?: Partial<ChatSelfPresenceSettings> & { status?: ChatSelfStatusKey }
): ChatSelfPresenceSettings {
  const statusRaw = normalizeText(payload?.status).toLowerCase();
  const status: ChatSelfStatusKey =
    statusRaw === 'online' || statusRaw === 'away' || statusRaw === 'offline' || statusRaw === 'dnd' || statusRaw === 'custom'
      ? (statusRaw as ChatSelfStatusKey)
      : 'online';
  const emoji = Array.from(normalizeText(payload?.emoji).replace(/\s+/g, ' ')).slice(0, 6).join('');
  const expiresAtRaw = normalizeText(payload?.expiresAt);
  const expiresAt = expiresAtRaw && !Number.isNaN(new Date(expiresAtRaw).getTime()) ? new Date(expiresAtRaw).toISOString() : null;
  if (status === 'custom') {
    const fallback = '#0ea5e9';
    return {
      status,
      label: normalizeText(payload?.label).slice(0, 80) || 'Benutzerdefiniert',
      color: sanitizePresenceColor(payload?.color, fallback),
      emoji: emoji || '💬',
      expiresAt,
    };
  }
  return {
    status,
    label: '',
    color: sanitizePresenceColor(payload?.color, SELF_STATUS_PRESETS[status].color),
    emoji: emoji || SELF_STATUS_PRESETS[status].emoji,
    expiresAt,
  };
}

function resolveSelfStatusLabel(settings: ChatSelfPresenceSettings): string {
  if (settings.status === 'custom') return normalizeText(settings.label) || 'Benutzerdefiniert';
  return SELF_STATUS_PRESETS[settings.status]?.label || 'Online';
}

function resolveSelfStatusEmoji(settings: ChatSelfPresenceSettings): string {
  if (settings.status === 'custom') return normalizeText(settings.emoji) || '💬';
  return normalizeText(settings.emoji) || SELF_STATUS_PRESETS[settings.status]?.emoji || '🟢';
}

function resolveSelfStatusDisplayLabel(settings: ChatSelfPresenceSettings): string {
  const emoji = resolveSelfStatusEmoji(settings);
  const label = resolveSelfStatusLabel(settings);
  return emoji ? `${emoji} ${label}` : label;
}

function resolveSelfStatusColor(settings: ChatSelfPresenceSettings): string {
  if (settings.status === 'custom') return sanitizePresenceColor(settings.color, '#0ea5e9');
  return SELF_STATUS_PRESETS[settings.status]?.color || '#16a34a';
}

function toPresenceLocalDateTimeValue(iso: string | null | undefined): string {
  const normalized = normalizeText(iso);
  if (!normalized) return '';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return '';
  const localDate = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function fromPresenceLocalDateTimeValue(value: string): string | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function formatPresenceExpiryLabel(expiresAt: string | null | undefined): string {
  const normalized = normalizeText(expiresAt);
  if (!normalized) return '';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return '';
  return `bis ${parsed.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedText(text: string, query: string): React.ReactNode {
  const source = String(text || '');
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return source;
  const pattern = new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'gi');
  const parts = source.split(pattern);
  return parts.map((part, index) =>
    part.toLowerCase() === normalizedQuery.toLowerCase() ? (
      <Box
        key={`hl-${index}-${part}`}
        component="mark"
        sx={{
          px: 0.15,
          borderRadius: 0.5,
          bgcolor: '#fde68a',
          color: '#111827',
        }}
      >
        {part}
      </Box>
    ) : (
      <React.Fragment key={`tx-${index}-${part}`}>{part}</React.Fragment>
    )
  );
}

const STATUS_COLORS: Record<ChatConnectionHealthState, 'default' | 'warning' | 'success' | 'error'> = {
  offline: 'default',
  online: 'success',
  degraded: 'warning',
  reconnecting: 'warning',
  fallback_bosh: 'warning',
};

const STATUS_LABELS: Record<ChatConnectionHealthState, string> = {
  offline: 'Offline',
  online: 'Online',
  degraded: 'Eingeschränkt',
  reconnecting: 'Verbinde erneut…',
  fallback_bosh: 'Fallback (BOSH)',
};

const actionButtonSx = {
  borderRadius: 2,
  bgcolor: '#ffffff',
  border: '1px solid #d7e3f4',
  color: '#14539f',
  boxShadow: '0 2px 8px rgba(15, 23, 42, 0.08)',
  transition: 'all 0.18s ease',
  '&:hover': {
    bgcolor: '#eaf3ff',
    borderColor: '#8db6f2',
    color: '#0a3a78',
    transform: 'translateY(-1px)',
    boxShadow: '0 6px 14px rgba(30, 64, 175, 0.18)',
  },
};

const AdminChatOverlay: React.FC<AdminChatOverlayProps> = ({ token, embedded = false, hideLauncher = false }) => {
  const navigate = useNavigate();
  const isNarrowScreen = useMediaQuery('(max-width: 920px)');
  const initialUrl = useMemo(() => new URL(window.location.href), []);
  const chatClientId = useMemo(() => ensureChatClientId(CHAT_CLIENT_ID_STORAGE_KEY), []);
  const detachedView = initialUrl.searchParams.get('chatWindow') === '1';

  const [open, setOpen] = useState(detachedView || embedded);
  const [tabMode, setTabMode] = useState<TabMode>('direct');
  const [bootstrap, setBootstrap] = useState<ChatBootstrap | null>(null);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('offline');
  const [connectionHealthState, setConnectionHealthState] = useState<ChatConnectionHealthState>('offline');
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatMessage[]>>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, PresenceState>>({});
  const [selfPresence, setSelfPresence] = useState<ChatSelfPresenceSettings>(DEFAULT_SELF_PRESENCE);
  const [presenceDialogOpen, setPresenceDialogOpen] = useState(false);
  const [presenceSaving, setPresenceSaving] = useState(false);
  const [presenceDraft, setPresenceDraft] = useState<ChatSelfPresenceSettings>(DEFAULT_SELF_PRESENCE);
  const [typingByConversation, setTypingByConversation] = useState<Record<string, string>>({});
  const [chatDisplayMode, setChatDisplayMode] = useState<ChatDisplayMode>(() => {
    const stored = localStorage.getItem(CHAT_UI_MODE_KEY);
    if (stored === 'floating') return 'floating';
    return 'drawer';
  });
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition>(() => {
    const raw = localStorage.getItem(CHAT_FLOAT_POS_KEY);
    if (!raw) return { x: Math.max(20, window.innerWidth - 980), y: 90 };
    try {
      const parsed = JSON.parse(raw) as FloatingPosition;
      if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
        return { x: Math.max(8, parsed.x), y: Math.max(8, parsed.y) };
      }
    } catch {
      // noop
    }
    return { x: Math.max(20, window.innerWidth - 980), y: 90 };
  });
  const [browserNotifyEnabled, setBrowserNotifyEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem(CHAT_BROWSER_NOTIFY_KEY);
    if (stored === '0') return false;
    return true;
  });
  const [conversationListOpen, setConversationListOpen] = useState<boolean>(() => {
    const stored = localStorage.getItem(CHAT_LIST_PANEL_OPEN_KEY);
    if (stored === '0') return false;
    return true;
  });
  const [directViewMode, setDirectViewMode] = useState<DirectDirectoryViewMode>(() => {
    const stored = normalizeText(localStorage.getItem(CHAT_DIRECT_VIEW_MODE_KEY)).toLowerCase();
    return stored === 'hierarchy' ? 'hierarchy' : 'list';
  });
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [statusMenuAnchorEl, setStatusMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [conversationSearch, setConversationSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [emojiMenuAnchorEl, setEmojiMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [reactionMenuAnchorEl, setReactionMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [reactionTargetMessageId, setReactionTargetMessageId] = useState<string>('');
  const [quoteTarget, setQuoteTarget] = useState<ChatMessage | null>(null);
  const [xmppLatencyMs, setXmppLatencyMs] = useState<number | null>(null);
  const [syncingXmppHistory, setSyncingXmppHistory] = useState(false);
  const [callSession, setCallSession] = useState<ChatCallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<PendingIncomingCall | null>(null);
  const [callMuted, setCallMuted] = useState(false);
  const [callSpeakerMuted, setCallSpeakerMuted] = useState(false);
  const [callStatusText, setCallStatusText] = useState('');
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState<string>(DEFAULT_AUDIO_OUTPUT_DEVICE_ID);
  const [callNeedsAudioUnlock, setCallNeedsAudioUnlock] = useState(false);
  const [callDebugDialogOpen, setCallDebugDialogOpen] = useState(false);
  const [callDebugEntries, setCallDebugEntries] = useState<CallDebugEntry[]>([]);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const xmppRef = useRef<any | null>(null);
  const joinedRoomsRef = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const lastTypingStateRef = useRef<Record<string, 'composing' | 'paused'>>({});
  const typingStopTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const pendingIqRequestsRef = useRef<
    Map<string, { resolve: (stanza: any) => void; reject: (error: Error) => void; timer: number }>
  >(new Map());
  const lastDisplayedMarkerRef = useRef<Record<string, string>>({});
  const lastReadSyncAtRef = useRef<Record<string, number>>({});
  const autoArchiveSyncedRef = useRef<Set<string>>(new Set());
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingRemoteCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const connectionStateRef = useRef<ConnectionState>('offline');
  const activeTransportRef = useRef<'websocket' | 'bosh'>('websocket');
  const callSessionRef = useRef<ChatCallSession | null>(null);
  const incomingCallRef = useRef<PendingIncomingCall | null>(null);
  const callHistoryLoggedRef = useRef<Set<string>>(new Set());
  const remoteTrackTimeoutRef = useRef<number | null>(null);
  const remoteTrackReceivedRef = useRef<boolean>(false);
  const remoteTrackCallIdRef = useRef<string>('');
  const previousCallStateRef = useRef<string>('');
  const previousCallStatusRef = useRef<string>('');
  const wasEmbeddedRef = useRef<boolean>(embedded);
  const shouldStickToBottomRef = useRef<boolean>(true);
  const lastAutoScrollConversationRef = useRef<string>('');

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const appendCallDebugEntry = useCallback(
    (category: CallDebugEntry['category'], message: string) => {
      const normalizedMessage = normalizeText(message);
      if (!normalizedMessage) return;
      setCallDebugEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.category === category && last.message === normalizedMessage) {
          return prev;
        }
        const next: CallDebugEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          at: new Date().toISOString(),
          category,
          message: normalizedMessage,
        };
        const merged = [...prev, next];
        if (merged.length > CALL_DEBUG_MAX_ENTRIES) {
          return merged.slice(merged.length - CALL_DEBUG_MAX_ENTRIES);
        }
        return merged;
      });
    },
    []
  );

  useEffect(() => {
    const chatFromQuery = normalizeText(initialUrl.searchParams.get('chat'));
    if (chatFromQuery) {
      setOpen(true);
      setActiveConversationId(chatFromQuery);
    }
    if (detachedView) {
      setChatDisplayMode('floating');
    }
  }, [initialUrl, detachedView]);

  useEffect(() => {
    const wasEmbedded = wasEmbeddedRef.current;
    if (embedded) {
      setOpen(true);
    } else if (wasEmbedded && hideLauncher) {
      setOpen(false);
    }
    wasEmbeddedRef.current = embedded;
  }, [embedded, hideLauncher]);

  useEffect(() => {
    localStorage.setItem(CHAT_UI_MODE_KEY, chatDisplayMode);
  }, [chatDisplayMode]);

  useEffect(() => {
    localStorage.setItem(CHAT_FLOAT_POS_KEY, JSON.stringify(floatingPosition));
  }, [floatingPosition]);

  useEffect(() => {
    localStorage.setItem(CHAT_BROWSER_NOTIFY_KEY, browserNotifyEnabled ? '1' : '0');
  }, [browserNotifyEnabled]);

  useEffect(() => {
    localStorage.setItem(CHAT_LIST_PANEL_OPEN_KEY, conversationListOpen ? '1' : '0');
  }, [conversationListOpen]);

  useEffect(() => {
    localStorage.setItem(CHAT_DIRECT_VIEW_MODE_KEY, directViewMode);
  }, [directViewMode]);

  useEffect(() => {
    if (!messageListRef.current) return;
    const container = messageListRef.current;
    const conversationChanged = lastAutoScrollConversationRef.current !== activeConversationId;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceToBottom <= CHAT_SCROLL_BOTTOM_THRESHOLD_PX;
    if (conversationChanged || shouldStickToBottomRef.current || nearBottom) {
      container.scrollTop = container.scrollHeight;
      shouldStickToBottomRef.current = true;
      setShowScrollToBottom(false);
    } else {
      setShowScrollToBottom(true);
    }
    lastAutoScrollConversationRef.current = activeConversationId;
  }, [activeConversationId, messagesByConversation]);

  useEffect(() => {
    callSessionRef.current = callSession;
  }, [callSession]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
    if (connectionState === 'online') {
      setConnectionHealthState(activeTransportRef.current === 'bosh' ? 'fallback_bosh' : 'online');
      return;
    }
    if (connectionState === 'reconnecting' || connectionState === 'connecting') {
      setConnectionHealthState('reconnecting');
      return;
    }
    if (connectionState === 'error') {
      setConnectionHealthState('degraded');
      return;
    }
    setConnectionHealthState('offline');
  }, [connectionState]);

  useEffect(() => {
    const callId = normalizeText(callSession?.callId);
    const callState = normalizeText(callSession?.state);
    const marker = callId ? `${callId}:${callState}` : '';
    if (!marker || marker === previousCallStateRef.current) return;
    previousCallStateRef.current = marker;
    appendCallDebugEntry('state', `Call ${callId.slice(-6)} -> ${callState}`);
  }, [appendCallDebugEntry, callSession?.callId, callSession?.state]);

  useEffect(() => {
    const status = normalizeText(callStatusText);
    if (!status || status === previousCallStatusRef.current) return;
    previousCallStatusRef.current = status;
    appendCallDebugEntry('status', status);
  }, [appendCallDebugEntry, callStatusText]);

  const assistantConversation = useMemo<ConversationEntry | null>(() => {
    if (!bootstrap?.assistant || bootstrap.assistant.enabled !== true) return null;
    const conversationId = normalizeText(bootstrap.assistant.conversationId) || 'assistant:self';
    return {
      id: conversationId,
      label: normalizeText(bootstrap.assistant.displayName) || 'behebes KI-Assistent',
      subtitle: normalizeText(bootstrap.assistant.subtitle) || 'Persönlicher KI-Assistent',
      jid: '',
      type: 'assistant',
    };
  }, [bootstrap]);

  const systemConversation = useMemo<ConversationEntry | null>(() => {
    if (!bootstrap?.systemUser || bootstrap.systemUser.enabled !== true) return null;
    const conversationId = normalizeText(bootstrap.systemUser.conversationId) || 'system:self';
    return {
      id: conversationId,
      label: normalizeText(bootstrap.systemUser.displayName) || 'behebes System',
      subtitle: normalizeText(bootstrap.systemUser.subtitle) || 'Systemmeldungen',
      jid: '',
      type: 'system',
    };
  }, [bootstrap]);

  const directConversations = useMemo<ConversationEntry[]>(() => {
    if (!bootstrap) {
      return [assistantConversation, systemConversation].filter(Boolean) as ConversationEntry[];
    }
    const assistantConversationId = normalizeText(assistantConversation?.id).toLowerCase();
    const systemConversationId = normalizeText(systemConversation?.id).toLowerCase();
    const seenContactIds = new Set<string>();
    const contacts = bootstrap.contacts
      .filter((contact) => {
        const contactIdRaw = normalizeText(contact.id);
        if (!contactIdRaw || contactIdRaw === bootstrap.me.id) return false;
        const contactId = contactIdRaw.toLowerCase();
        const contactJid = normalizeText(contact.jid).toLowerCase();
        const assistantShadow =
          contactId.startsWith('assistant:') ||
          contactJid.startsWith('assistant@') ||
          (assistantConversationId && (`direct:${contactId}` === assistantConversationId || contactId === assistantConversationId));
        const systemShadow =
          contactId.startsWith('system:') ||
          contactJid.startsWith('system@') ||
          (systemConversationId && (`direct:${contactId}` === systemConversationId || contactId === systemConversationId));
        if (assistantShadow || systemShadow) return false;
        if (seenContactIds.has(contactId)) return false;
        seenContactIds.add(contactId);
        return true;
      })
      .map((contact) => ({
        id: `direct:${normalizeText(contact.id)}`,
        label: contact.displayName || contact.username || contact.id,
        subtitle: contact.email || contact.role,
        jid: contact.jid,
        type: 'direct' as const,
        contactId: contact.id,
      }));
    const special = [assistantConversation, systemConversation].filter(Boolean) as ConversationEntry[];
    return [...special, ...contacts];
  }, [assistantConversation, bootstrap, systemConversation]);

  const directHumanConversations = useMemo<ConversationEntry[]>(
    () => directConversations.filter((entry) => entry.type === 'direct'),
    [directConversations]
  );

  const groupConversations = useMemo<ConversationEntry[]>(() => {
    if (!bootstrap) return [];
    const org = (bootstrap.groups?.org || []).map((group) => ({
      id: group.id,
      label: group.name,
      subtitle: `Orga-Einheit (${group.members?.length || 0})`,
      jid: group.roomJid,
      type: 'group' as const,
    }));
    const custom = (bootstrap.groups?.custom || []).map((group) => ({
      id: group.id,
      label: group.name,
      subtitle: `Freie Gruppe (${group.members?.length || 0})`,
      jid: group.roomJid,
      type: 'group' as const,
    }));
    return [...org, ...custom];
  }, [bootstrap]);

  const allConversations = useMemo(() => [...directConversations, ...groupConversations], [directConversations, groupConversations]);

  const directConversationByContactId = useMemo(() => {
    const map = new Map<string, ConversationEntry>();
    for (const entry of directHumanConversations) {
      const contactId = normalizeText(entry.contactId);
      if (!contactId) continue;
      map.set(contactId, entry);
    }
    return map;
  }, [directHumanConversations]);

  const directoryOrgUnits = useMemo<ChatDirectoryOrgUnit[]>(() => {
    const source = Array.isArray(bootstrap?.directory?.orgUnits) ? bootstrap?.directory?.orgUnits : [];
    return source
      .map((entry) => ({
        id: normalizeText(entry?.id),
        tenantId: normalizeText(entry?.tenantId),
        tenantName: normalizeText(entry?.tenantName),
        parentId: normalizeText(entry?.parentId) || null,
        name: normalizeText(entry?.name) || normalizeText(entry?.id),
      }))
      .filter((entry) => !!entry.id)
      .sort((a, b) => {
        const tenantCmp = compareLocaleText(a.tenantName || '', b.tenantName || '');
        if (tenantCmp !== 0) return tenantCmp;
        return compareLocaleText(a.name, b.name);
      });
  }, [bootstrap?.directory?.orgUnits]);

  const directoryOrgUnitById = useMemo(() => {
    const map = new Map<string, ChatDirectoryOrgUnit>();
    for (const unit of directoryOrgUnits) {
      map.set(unit.id, unit);
    }
    return map;
  }, [directoryOrgUnits]);

  const directoryContactScopes = useMemo<DirectoryContactScopeEntry[]>(() => {
    const source = Array.isArray(bootstrap?.directory?.contactScopes) ? bootstrap?.directory?.contactScopes : [];
    return source
      .map((entry) => ({
        contactId: normalizeText(entry?.contactId),
        orgUnitId: normalizeText(entry?.orgUnitId),
        orgUnitName: normalizeText(entry?.orgUnitName),
        tenantName: normalizeText(entry?.tenantName),
        canWrite: entry?.canWrite === true,
      }))
      .filter((entry) => !!entry.contactId && !!entry.orgUnitId && directConversationByContactId.has(entry.contactId))
      .sort((a, b) => {
        const unitCmp = compareLocaleText(a.orgUnitName || a.orgUnitId, b.orgUnitName || b.orgUnitId);
        if (unitCmp !== 0) return unitCmp;
        const aConversation = directConversationByContactId.get(a.contactId);
        const bConversation = directConversationByContactId.get(b.contactId);
        const aLabel = normalizeText(aConversation?.label) || a.contactId;
        const bLabel = normalizeText(bConversation?.label) || b.contactId;
        return compareLocaleText(aLabel, bLabel);
      });
  }, [bootstrap?.directory?.contactScopes, directConversationByContactId]);

  const directoryScopesByOrgUnitId = useMemo(() => {
    const map = new Map<string, DirectoryContactScopeEntry[]>();
    for (const scope of directoryContactScopes) {
      const bucket = map.get(scope.orgUnitId) || [];
      bucket.push(scope);
      map.set(scope.orgUnitId, bucket);
    }
    return map;
  }, [directoryContactScopes]);

  const directoryChildrenByParentId = useMemo(() => {
    const map = new Map<string, ChatDirectoryOrgUnit[]>();
    for (const unit of directoryOrgUnits) {
      const parentKey = unit.parentId && directoryOrgUnitById.has(unit.parentId) ? unit.parentId : CHAT_DIRECTORY_ROOT_KEY;
      const bucket = map.get(parentKey) || [];
      bucket.push(unit);
      map.set(parentKey, bucket);
    }
    for (const [key, bucket] of map.entries()) {
      bucket.sort((a, b) => {
        const tenantCmp = compareLocaleText(a.tenantName || '', b.tenantName || '');
        if (tenantCmp !== 0) return tenantCmp;
        return compareLocaleText(a.name, b.name);
      });
      map.set(key, bucket);
    }
    return map;
  }, [directoryOrgUnits, directoryOrgUnitById]);

  const directConversationIdsWithScopes = useMemo(() => {
    const set = new Set<string>();
    for (const scope of directoryContactScopes) {
      const conversation = directConversationByContactId.get(scope.contactId);
      if (!conversation) continue;
      set.add(conversation.id);
    }
    return set;
  }, [directoryContactScopes, directConversationByContactId]);

  const directConversationsWithoutScopes = useMemo(
    () =>
      directHumanConversations.filter((entry) => !directConversationIdsWithScopes.has(entry.id)),
    [directHumanConversations, directConversationIdsWithScopes]
  );

  const customGroupByConversationId = useMemo(() => {
    const map = new Map<string, ChatGroup>();
    for (const group of bootstrap?.groups?.custom || []) {
      if (!group?.id) continue;
      map.set(group.id, group);
    }
    return map;
  }, [bootstrap?.groups?.custom]);

  const activeConversation = useMemo(
    () => allConversations.find((entry) => entry.id === activeConversationId) || null,
    [allConversations, activeConversationId]
  );
  const activeCallConversation = useMemo(
    () =>
      callSession?.conversationId
        ? allConversations.find((entry) => entry.id === callSession.conversationId) || null
        : null,
    [allConversations, callSession?.conversationId]
  );
  const callOverlayVisible =
    !!callSession && callSession.state !== 'ended' && callSession.state !== 'failed';
  const callOverlayBottom = hideLauncher || embedded ? 20 : 96;
  const rtcBestEffortOnly = bootstrap?.xmpp?.rtc?.bestEffortOnly === true;
  const rtcReliabilityHints = Array.isArray(bootstrap?.xmpp?.rtc?.reliabilityHints)
    ? (bootstrap?.xmpp?.rtc?.reliabilityHints || []).map((entry) => normalizeText(entry)).filter(Boolean)
    : [];

  const activeMessages = useMemo(() => messagesByConversation[activeConversationId] || [], [messagesByConversation, activeConversationId]);

  useEffect(() => {
    if (!quoteTarget?.id) return;
    const quoteConversationId = normalizeText(quoteTarget.conversationId);
    if (!quoteConversationId) return;
    if (quoteConversationId !== activeConversationId) {
      setQuoteTarget(null);
    }
  }, [activeConversationId, quoteTarget]);

  const unreadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.entries(messagesByConversation).forEach(([conversationId, messages]) => {
      const unread = messages.filter(
        (message) =>
          message.senderAdminUserId !== bootstrap?.me.id &&
          !message.readAtByMe &&
          conversationId !== activeConversationId
      ).length;
      if (unread > 0) counts[conversationId] = unread;
    });
    return counts;
  }, [messagesByConversation, activeConversationId, bootstrap?.me.id]);

  const totalUnread = useMemo(() => Object.values(unreadCounts).reduce((acc, value) => acc + value, 0), [unreadCounts]);

  const availableAudioOutputOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ id: string; label: string }> = [];
    for (const device of audioOutputDevices) {
      const id = normalizeText(device.deviceId) || DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
      if (seen.has(id)) continue;
      seen.add(id);
      const fallbackLabel = id === DEFAULT_AUDIO_OUTPUT_DEVICE_ID ? 'Systemstandard' : `Ausgabegerät ${options.length + 1}`;
      options.push({
        id,
        label: normalizeText(device.label) || fallbackLabel,
      });
    }
    if (!seen.has(DEFAULT_AUDIO_OUTPUT_DEVICE_ID)) {
      options.unshift({ id: DEFAULT_AUDIO_OUTPUT_DEVICE_ID, label: 'Systemstandard' });
    }
    return options;
  }, [audioOutputDevices]);

  const canSelectAudioOutput = useMemo(() => {
    if (typeof window === 'undefined' || typeof HTMLMediaElement === 'undefined') return false;
    return 'setSinkId' in HTMLMediaElement.prototype && availableAudioOutputOptions.length > 0;
  }, [availableAudioOutputOptions.length]);

  const appendMessages = useCallback((conversationId: string, items: ChatMessage[]) => {
    if (!conversationId || items.length === 0) return;
    setMessagesByConversation((prev) => {
      const existing = prev[conversationId] || [];
      const keyOf = (entry: ChatMessage) => `${entry.id || ''}:${entry.xmppStanzaId || ''}:${entry.createdAt || ''}`;
      const byKey = new Map(existing.map((entry) => [keyOf(entry), entry]));
      for (const item of items) {
        const key = keyOf(item);
        const oldItem = byKey.get(key);
        byKey.set(key, oldItem ? { ...oldItem, ...item } : item);
      }
      const merged = Array.from(byKey.values());
      merged.sort((a, b) => new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime());
      return {
        ...prev,
        [conversationId]: merged,
      };
    });
  }, []);

  const replaceOptimisticMessage = useCallback(
    (conversationId: string, optimisticId: string, items: ChatMessage[]) => {
      const convId = normalizeText(conversationId);
      const tempId = normalizeText(optimisticId);
      if (!convId || !tempId) return;
      setMessagesByConversation((prev) => {
        const existing = prev[convId] || [];
        const filtered = existing.filter((entry) => normalizeText(entry.id) !== tempId);
        if (items.length === 0) {
          return {
            ...prev,
            [convId]: filtered,
          };
        }
        const merged = [...filtered, ...items];
        merged.sort((a, b) => new Date(a.createdAt || '').getTime() - new Date(b.createdAt || '').getTime());
        return {
          ...prev,
          [convId]: merged,
        };
      });
    },
    []
  );

  const applyMessagePatchByStanzaId = useCallback(
    (conversationId: string, stanzaId: string, patch: Partial<ChatMessage>) => {
      const convId = normalizeText(conversationId);
      const xmppId = normalizeText(stanzaId);
      if (!convId || !xmppId) return;
      setMessagesByConversation((prev) => {
        const existing = prev[convId] || [];
        if (existing.length === 0) return prev;
        let touched = false;
        const next = existing.map((entry) => {
          if (normalizeText(entry.xmppStanzaId) !== xmppId) return entry;
          touched = true;
          return { ...entry, ...patch };
        });
        if (!touched) return prev;
        return {
          ...prev,
          [convId]: next,
        };
      });
    },
    []
  );

  const sendXmppIqRequest = useCallback(async (iqStanza: any, timeoutMs = XMPP_PING_TIMEOUT_MS) => {
    const xmpp = xmppRef.current;
    if (!xmpp || connectionStateRef.current !== 'online') {
      throw new Error('XMPP ist nicht verbunden.');
    }
    const requestId = normalizeText(iqStanza?.attrs?.id) || `iq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    iqStanza.attrs = {
      ...(iqStanza.attrs || {}),
      id: requestId,
    };

    return await new Promise<any>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingIqRequestsRef.current.delete(requestId);
        reject(new Error('XMPP IQ Timeout'));
      }, Math.max(1000, timeoutMs));

      pendingIqRequestsRef.current.set(requestId, {
        resolve,
        reject,
        timer,
      });

      try {
        const sendResult = xmpp.send(iqStanza);
        Promise.resolve(sendResult).catch((error: any) => {
          const pending = pendingIqRequestsRef.current.get(requestId);
          if (pending) {
            window.clearTimeout(pending.timer);
            pendingIqRequestsRef.current.delete(requestId);
          }
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      } catch (error: any) {
        const pending = pendingIqRequestsRef.current.get(requestId);
        if (pending) {
          window.clearTimeout(pending.timer);
          pendingIqRequestsRef.current.delete(requestId);
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }, []);

  const requestBrowserNotificationPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setBrowserPermission('denied');
      return 'denied' as const;
    }
    if (Notification.permission === 'granted') {
      setBrowserPermission('granted');
      return 'granted' as const;
    }
    const result = await Notification.requestPermission();
    setBrowserPermission(result);
    return result;
  }, []);

  const showBrowserNotification = useCallback(
    (input: { title: string; body: string; conversationId: string }) => {
      if (!browserNotifyEnabled) return;
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;

      const notification = new Notification(input.title, {
        body: input.body,
        tag: `admin-chat-${input.conversationId}`,
        renotify: false,
      });
      notification.onclick = () => {
        window.focus();
        setOpen(true);
        setActiveConversationId(input.conversationId);
        notification.close();
      };
    },
    [browserNotifyEnabled]
  );

  const sendDisplayedMarkerForConversation = useCallback(
    async (conversationId: string) => {
      const convId = normalizeText(conversationId);
      if (!convId || connectionState !== 'online' || !bootstrap) return;
      const conversation = allConversations.find((entry) => entry.id === convId) || null;
      if (!conversation || conversation.type !== 'direct') return;

      const items = messagesByConversation[convId] || [];
      if (items.length === 0) return;
      const latestInboundWithStanza = [...items]
        .reverse()
        .find(
          (entry) =>
            entry.senderAdminUserId !== bootstrap.me.id &&
            !!normalizeText(entry.xmppStanzaId)
        );
      const targetStanzaId = normalizeText(latestInboundWithStanza?.xmppStanzaId);
      if (!targetStanzaId) return;

      if (lastDisplayedMarkerRef.current[convId] === targetStanzaId) return;
      const xmpp = xmppRef.current;
      if (!xmpp) return;
      try {
        await xmpp.send(
          xml(
            'message',
            { to: conversation.jid, type: 'chat' },
            xml('displayed', { xmlns: XMPP_NS_CHAT_MARKERS, id: targetStanzaId }),
            xml('active', { xmlns: XMPP_NS_CHAT_STATES })
          )
        );
        lastDisplayedMarkerRef.current[convId] = targetStanzaId;
      } catch {
        // Marker is optional.
      }
    },
    [allConversations, bootstrap, connectionState, messagesByConversation]
  );

  const markConversationRead = useCallback(
    async (conversationId: string, force = false) => {
      if (!conversationId) return;
      const now = Date.now();
      const lastSyncedAt = lastReadSyncAtRef.current[conversationId] || 0;
      if (!force && now - lastSyncedAt < CHAT_READ_SYNC_MIN_INTERVAL_MS) {
        return;
      }
      lastReadSyncAtRef.current[conversationId] = now;
      try {
        await axios.post(
          '/api/admin/chat/messages/read',
          { conversationId },
          { headers }
        );
        const stamp = new Date().toISOString();
        setMessagesByConversation((prev) => {
          const items = prev[conversationId] || [];
          if (items.length === 0) return prev;
          return {
            ...prev,
            [conversationId]: items.map((entry) =>
              entry.senderAdminUserId !== bootstrap?.me.id
                ? { ...entry, readAtByMe: entry.readAtByMe || stamp }
                : entry
            ),
          };
        });
        void sendDisplayedMarkerForConversation(conversationId);
      } catch {
        lastReadSyncAtRef.current[conversationId] = 0;
        // Non-blocking for UI.
      }
    },
    [bootstrap?.me.id, headers, sendDisplayedMarkerForConversation]
  );

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearPingTimer = useCallback(() => {
    if (pingTimerRef.current) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const clearRemoteTrackTimeout = useCallback(() => {
    if (remoteTrackTimeoutRef.current) {
      window.clearTimeout(remoteTrackTimeoutRef.current);
      remoteTrackTimeoutRef.current = null;
    }
  }, []);

  const sendXmppPing = useCallback(async () => {
    if (connectionState !== 'online' || !bootstrap?.xmpp?.domain) return;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      await sendXmppIqRequest(
        xml(
          'iq',
          {
            type: 'get',
            to: bootstrap.xmpp.domain,
            id: `ping_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          },
          xml('ping', { xmlns: XMPP_NS_PING })
        ),
        XMPP_PING_TIMEOUT_MS
      );
      const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      setXmppLatencyMs(Math.max(1, Math.round(finishedAt - startedAt)));
    } catch {
      setXmppLatencyMs(null);
    }
  }, [bootstrap?.xmpp?.domain, connectionState, sendXmppIqRequest]);

  const enableXmppCarbons = useCallback(async () => {
    if (connectionStateRef.current !== 'online') return;
    try {
      await sendXmppIqRequest(
        xml(
          'iq',
          {
            type: 'set',
            id: `carbons_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          },
          xml('enable', { xmlns: XMPP_NS_CARBONS })
        ),
        12000
      );
      appendCallDebugEntry('event', 'XMPP Carbons aktiviert');
    } catch {
      appendCallDebugEntry('status', 'XMPP Carbons konnten nicht aktiviert werden');
    }
  }, [appendCallDebugEntry, sendXmppIqRequest]);

  const resolveRtcIceServers = useCallback((): RTCIceServer[] => {
    const fromBootstrap = Array.isArray(bootstrap?.xmpp?.rtc?.iceServers) ? bootstrap?.xmpp?.rtc?.iceServers : [];
    const normalized = fromBootstrap
      .map((entry) => {
        const urlsSource = Array.isArray(entry?.urls) ? entry.urls : [entry?.urls];
        const urls = urlsSource.map((item) => normalizeText(item)).filter(Boolean);
        if (urls.length === 0) return null;
        const server: RTCIceServer = { urls };
        const username = normalizeText(entry?.username);
        const credential = normalizeText(entry?.credential);
        if (username) server.username = username;
        if (credential) server.credential = credential;
        return server;
      })
      .filter((entry): entry is RTCIceServer => !!entry);
    if (normalized.length > 0) return normalized;
    return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  }, [bootstrap?.xmpp?.rtc?.iceServers]);

  const refreshAudioOutputDevices = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    if (!navigator?.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((device) => device.kind === 'audiooutput');
      setAudioOutputDevices(outputs);
      setSelectedAudioOutputId((current) => {
        if (outputs.length === 0) return DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
        const normalizedCurrent = normalizeText(current);
        if (normalizedCurrent && outputs.some((device) => device.deviceId === normalizedCurrent)) {
          return normalizedCurrent;
        }
        const defaultDevice = outputs.find((device) => device.deviceId === DEFAULT_AUDIO_OUTPUT_DEVICE_ID);
        if (defaultDevice) return defaultDevice.deviceId;
        return outputs[0]?.deviceId || DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
      });
      return outputs;
    } catch {
      return [];
    }
  }, []);

  const applyAudioOutputDevice = useCallback(
    async (sinkId?: string): Promise<boolean> => {
      const audioElement = remoteAudioRef.current as SinkCapableAudioElement | null;
      if (!audioElement?.setSinkId) return true;
      const requestedSink = normalizeText(sinkId || selectedAudioOutputId) || DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
      const knownSinkIds = new Set(
        availableAudioOutputOptions
          .map((entry) => normalizeText(entry.id))
          .filter(Boolean)
      );
      const targetSink =
        knownSinkIds.size > 0 && !knownSinkIds.has(requestedSink)
          ? DEFAULT_AUDIO_OUTPUT_DEVICE_ID
          : requestedSink;
      const currentSink =
        normalizeText((audioElement as SinkCapableAudioElement).sinkId) || DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
      if (currentSink === targetSink) return true;
      if (targetSink !== requestedSink) {
        appendCallDebugEntry(
          'warn',
          `Gewähltes Ausgabegerät nicht mehr verfügbar (${requestedSink}); nutze Systemstandard`
        );
        setSelectedAudioOutputId(DEFAULT_AUDIO_OUTPUT_DEVICE_ID);
      }
      try {
        await audioElement.setSinkId(targetSink);
        return true;
      } catch (error: any) {
        const errorName = normalizeText(error?.name) || 'UnknownError';
        const errorText = normalizeText(error?.message);
        appendCallDebugEntry(
          'error',
          `Audioausgabe-Umschaltung fehlgeschlagen (${errorName})${errorText ? `: ${errorText}` : ''}`
        );
        if (targetSink !== DEFAULT_AUDIO_OUTPUT_DEVICE_ID) {
          try {
            await audioElement.setSinkId(DEFAULT_AUDIO_OUTPUT_DEVICE_ID);
            setSelectedAudioOutputId(DEFAULT_AUDIO_OUTPUT_DEVICE_ID);
            setErrorMessage('Ausgabegerät war nicht verfügbar. Systemstandard wird verwendet.');
            appendCallDebugEntry('warn', 'Fallback auf Systemstandard-Ausgabegerät angewendet');
            return true;
          } catch (fallbackError: any) {
            const fallbackName = normalizeText(fallbackError?.name) || 'UnknownError';
            const fallbackText = normalizeText(fallbackError?.message);
            appendCallDebugEntry(
              'error',
              `Fallback auf Systemstandard fehlgeschlagen (${fallbackName})${fallbackText ? `: ${fallbackText}` : ''}`
            );
          }
        }
        setErrorMessage('Audioausgabe konnte nicht auf das gewählte Gerät umgestellt werden.');
        return false;
      }
    },
    [appendCallDebugEntry, availableAudioOutputOptions, selectedAudioOutputId]
  );

  const resumeRemoteAudioPlayback = useCallback(
    async (options?: { silenceError?: boolean }): Promise<boolean> => {
      const audioElement = remoteAudioRef.current as SinkCapableAudioElement | null;
      if (!audioElement || !audioElement.srcObject) return false;
      audioElement.muted = callSpeakerMuted;
      await applyAudioOutputDevice(selectedAudioOutputId);
      if (callSpeakerMuted) {
        setCallNeedsAudioUnlock(false);
        return true;
      }
      try {
        await audioElement.play();
        setCallNeedsAudioUnlock(false);
        setCallStatusText((current) => {
          const normalizedCurrent = normalizeText(current).toLowerCase();
          if (normalizedCurrent.includes('audio aktivieren')) return 'Verbunden';
          return current;
        });
        return true;
      } catch (error: any) {
        const errorName = normalizeText(error?.name).toLowerCase();
        const requiresGesture =
          errorName === 'notallowederror' || errorName === 'aborterror' || errorName === 'securityerror';
        if (requiresGesture) {
          setCallNeedsAudioUnlock(true);
          setCallStatusText((current) => {
            const normalizedCurrent = normalizeText(current).toLowerCase();
            if (!normalizedCurrent || normalizedCurrent.startsWith('verbunden')) {
              return 'Verbunden · Audio aktivieren';
            }
            return current;
          });
          return false;
        }
        if (!options?.silenceError) {
          setErrorMessage(normalizeText(error?.message) || 'Audioausgabe konnte nicht gestartet werden.');
        }
        return false;
      }
    },
    [applyAudioOutputDevice, callSpeakerMuted, selectedAudioOutputId]
  );

  const sendXmppStanzaSafe = useCallback(
    async (
      stanza: any,
      options?: { strict?: boolean; context?: string }
    ): Promise<boolean> => {
      const xmpp = xmppRef.current;
      const context = normalizeText(options?.context) || 'XMPP';
      if (!xmpp || connectionStateRef.current !== 'online') {
        const error = new Error('XMPP ist nicht verbunden.');
        if (options?.strict) throw error;
        appendCallDebugEntry('status', `${context}: übersprungen (offline)`);
        return false;
      }
      try {
        await xmpp.send(stanza);
        return true;
      } catch (error: any) {
        const message = normalizeText(error?.message) || 'Unbekannter Sendefehler';
        appendCallDebugEntry('error', `${context}: ${message}`);
        if (options?.strict) {
          throw error;
        }
        return false;
      }
    },
    [appendCallDebugEntry]
  );

  const sendXmppCallMessage = useCallback(
    async (toJid: string, child: any, options?: { strict?: boolean }) => {
      const target = normalizeText(toJid);
      if (!target) {
        if (options?.strict) {
          throw new Error('Ziel-JID fehlt.');
        }
        return false;
      }
      return sendXmppStanzaSafe(xml('message', { to: target, type: 'chat' }, child), {
        strict: options?.strict,
        context: 'Call-Signalisierung',
      });
    },
    [sendXmppStanzaSafe]
  );

  const sendWebRtcSignal = useCallback(
    async (
      toJid: string,
      callId: string,
      signalType: 'offer' | 'answer' | 'ice',
      payload: { sdp?: string; candidate?: RTCIceCandidateInit | null }
    ) => {
      const call = normalizeText(callId);
      if (!call) return;
      const signalChildren: any[] = [];
      if ((signalType === 'offer' || signalType === 'answer') && normalizeText(payload.sdp)) {
        signalChildren.push(xml('sdp', {}, String(payload.sdp)));
      }
      if (signalType === 'ice' && payload.candidate) {
        signalChildren.push(xml('candidate', {}, JSON.stringify(payload.candidate)));
      }
      await sendXmppCallMessage(
        toJid,
        xml(
          'signal',
          {
            xmlns: XMPP_NS_WEBRTC,
            call: call,
            type: signalType,
          },
          ...signalChildren
        ),
        { strict: false }
      );
    },
    [sendXmppCallMessage]
  );

  const cleanupCallMedia = useCallback((options?: { keepLocalStream?: boolean }) => {
    clearRemoteTrackTimeout();
    const keepLocalStream = options?.keepLocalStream === true;
    const pc = peerConnectionRef.current;
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {
        // ignore
      }
    }
    peerConnectionRef.current = null;
    pendingRemoteCandidatesRef.current = [];

    if (!keepLocalStream && localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    remoteTrackReceivedRef.current = false;
    remoteTrackCallIdRef.current = '';
    setCallNeedsAudioUnlock(false);
  }, [clearRemoteTrackTimeout]);

  const ensureLocalAudioStream = useCallback(async (): Promise<MediaStream> => {
    if (localStreamRef.current) return localStreamRef.current;
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia wird vom Browser nicht unterstützt.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    localStreamRef.current = stream;
    void refreshAudioOutputDevices();
    return stream;
  }, [refreshAudioOutputDevices]);

  const ensureLocalVideoTrack = useCallback(async (): Promise<MediaStreamTrack> => {
    const baseStream = localStreamRef.current || (await ensureLocalAudioStream());
    const existingTrack = baseStream.getVideoTracks().find((track) => track.readyState === 'live');
    if (existingTrack) {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = baseStream;
      }
      return existingTrack;
    }
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Kamera wird vom Browser nicht unterstützt.');
    }
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    const videoTrack = cameraStream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error('Kein Videotrack verfügbar.');
    }
    baseStream.addTrack(videoTrack);
    for (const strayAudioTrack of cameraStream.getAudioTracks()) {
      try {
        strayAudioTrack.stop();
      } catch {
        // ignore
      }
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = baseStream;
    }
    return videoTrack;
  }, [ensureLocalAudioStream]);

  const removeLocalVideoTracks = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    for (const track of stream.getVideoTracks()) {
      try {
        track.stop();
      } catch {
        // ignore
      }
      stream.removeTrack(track);
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }, []);

  const createPeerConnectionForSession = useCallback(
    (session: ChatCallSession, stream: MediaStream): RTCPeerConnection => {
      const pc = new RTCPeerConnection({
        iceServers: resolveRtcIceServers(),
      });
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const candidate = event.candidate.toJSON ? event.candidate.toJSON() : event.candidate;
        void sendWebRtcSignal(session.targetJid, session.callId, 'ice', {
          candidate,
        }).catch(() => {
          // best effort: candidate delivery may race with connection teardown
        });
      };

      pc.ontrack = (event) => {
        const remoteStream = event.streams?.[0] || new MediaStream([event.track]);
        remoteTrackCallIdRef.current = session.callId;
        remoteTrackReceivedRef.current = true;
        clearRemoteTrackTimeout();
        appendCallDebugEntry('event', `Remote-Media empfangen (${event.track?.kind || 'track'})`);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.muted = callSpeakerMuted;
          void applyAudioOutputDevice(selectedAudioOutputId);
          void resumeRemoteAudioPlayback({ silenceError: true });
        }
        if (event.track?.kind === 'video' && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play().catch(() => undefined);
          setCallSession((current) =>
            current && current.callId === session.callId
              ? { ...current, mediaType: 'video', requestedMediaType: 'video', videoState: 'on' }
              : current
          );
        }
        setCallStatusText('Verbunden');
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected') {
          setCallSession((current) =>
            current && current.callId === session.callId ? { ...current, state: 'active' } : current
          );
          setCallStatusText('Verbunden');
          return;
        }
        if (state === 'failed' || state === 'disconnected') {
          setCallStatusText('Verbindung unterbrochen');
          setCallSession((current) =>
            current && current.callId === session.callId ? { ...current, state: 'failed' } : current
          );
          cleanupCallMedia();
          return;
        }
        if (state === 'closed') {
          setCallStatusText('Anruf beendet');
          setCallSession((current) =>
            current && current.callId === session.callId ? { ...current, state: 'ended' } : current
          );
          cleanupCallMedia();
        }
      };

      peerConnectionRef.current = pc;
      return pc;
    },
    [
      applyAudioOutputDevice,
      appendCallDebugEntry,
      callSpeakerMuted,
      clearRemoteTrackTimeout,
      cleanupCallMedia,
      resolveRtcIceServers,
      resumeRemoteAudioPlayback,
      selectedAudioOutputId,
      sendWebRtcSignal,
    ]
  );

  const callsEnabled = useMemo(() => bootstrap?.calls?.enabled !== false, [bootstrap?.calls?.enabled]);

  const sendPresenceHeartbeat = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!bootstrap) return;
      try {
        await axios.post(
          '/api/admin/chat/presence/heartbeat',
          {
            resource: normalizeText(bootstrap?.xmpp?.resource) || 'admin',
            transport: connectionStateRef.current === 'online' ? 'xmpp' : 'hybrid',
            appKind: 'admin',
          },
          {
            headers,
            params: { _ts: Date.now() },
          }
        );
      } catch (error: any) {
        if (!options?.silent) {
          const msg = normalizeText(error?.response?.data?.message || error?.message);
          if (msg) setErrorMessage(msg);
        }
      }
    },
    [bootstrap, headers]
  );

  const refreshPresenceSnapshot = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!bootstrap) return;
      try {
        const response = await axios.get('/api/admin/chat/presence/snapshot', {
          headers,
          params: {
            _ts: Date.now(),
          },
        });
        const items = Array.isArray(response.data?.items) ? response.data.items : [];
        if (items.length === 0) return;
        setPresenceByUserId((prev) => {
          const next = { ...prev };
          for (const item of items) {
            const userId = normalizeText(item?.userId);
            if (!userId) continue;
            const statusRaw = normalizeText(item?.status).toLowerCase();
            const status: PresenceState =
              statusRaw === 'online' || statusRaw === 'away' || statusRaw === 'dnd' ? (statusRaw as PresenceState) : 'offline';
            next[userId] = status;
          }
          return next;
        });
      } catch (error: any) {
        if (!options?.silent) {
          const msg = normalizeText(error?.response?.data?.message || error?.message);
          if (msg) setErrorMessage(msg);
        }
      }
    },
    [bootstrap, headers]
  );

  const claimIncomingCall = useCallback(
    async (pendingCall: PendingIncomingCall): Promise<boolean> => {
      if (!bootstrap) return false;
      try {
        const response = await axios.post(
          `/api/admin/chat/calls/${encodeURIComponent(pendingCall.callId)}/claim`,
          {
            callerUserId: pendingCall.fromAdminUserId || null,
            resource: normalizeText(bootstrap?.xmpp?.resource) || 'admin',
            transport: connectionStateRef.current === 'online' ? 'xmpp' : 'hybrid',
            appKind: 'admin',
            mediaType: pendingCall.mediaType || 'audio',
            clientConnectionId: chatClientId,
          },
          { headers }
        );
        const won = response?.data?.won === true;
        if (!won) {
          setCallStatusText('Anruf bereits auf einem anderen Gerät angenommen');
        }
        return won;
      } catch (error: any) {
        const message = normalizeText(error?.response?.data?.message || error?.message);
        if (message) setErrorMessage(message);
        return false;
      }
    },
    [bootstrap, headers, chatClientId]
  );

  const releaseCallClaim = useCallback(
    async (
      callId: string,
      state: 'ended' | 'failed' | 'cancelled' | 'rejected' = 'ended',
      options?: { endedReason?: string; mediaTypeFinal?: CallMediaType }
    ) => {
      const normalizedCallId = normalizeText(callId);
      if (!normalizedCallId || !bootstrap) return;
      try {
        await axios.post(
          `/api/admin/chat/calls/${encodeURIComponent(normalizedCallId)}/release`,
          {
            state,
            resource: normalizeText(bootstrap?.xmpp?.resource) || 'admin',
            endedReason: normalizeText(options?.endedReason || state) || undefined,
            mediaTypeFinal: options?.mediaTypeFinal || callSessionRef.current?.mediaType || 'audio',
          },
          { headers }
        );
      } catch {
        // best effort
      }
    },
    [bootstrap, headers]
  );

  const updateCallMediaState = useCallback(
    async (callId: string, payload: { mediaType: CallMediaType; requestedMediaType?: CallMediaType; upgradeState: string }) => {
      const normalizedCallId = normalizeText(callId);
      if (!normalizedCallId || !bootstrap) return;
      try {
        await axios.post(
          `/api/admin/chat/calls/${encodeURIComponent(normalizedCallId)}/media`,
          {
            mediaType: payload.mediaType,
            requestedMediaType: payload.requestedMediaType || payload.mediaType,
            upgradeState: payload.upgradeState,
            resource: normalizeText(bootstrap?.xmpp?.resource) || 'admin',
            appKind: 'admin',
            transport: connectionStateRef.current === 'online' ? 'xmpp' : 'hybrid',
            clientConnectionId: chatClientId,
          },
          { headers }
        );
      } catch {
        // keep call interaction resilient even if audit update fails
      }
    },
    [bootstrap, headers, chatClientId]
  );

  const handleMessageListScroll = useCallback(() => {
    const container = messageListRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distance <= CHAT_SCROLL_BOTTOM_THRESHOLD_PX;
    shouldStickToBottomRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);
  }, []);

  const loadBootstrap = useCallback(async () => {
    setLoadingBootstrap(true);
    setErrorMessage('');
    try {
      const response = await axios.get<ChatBootstrap>('/api/admin/chat/bootstrap', {
        headers,
        params: { _ts: Date.now(), appKind: 'admin', clientId: chatClientId },
      });
      const payload = response.data;
      const normalizedPayload: ChatBootstrap = {
        ...payload,
        xmpp: {
          ...(payload?.xmpp || ({} as ChatBootstrap['xmpp'])),
          websocketUrl: resolveXmppServiceUrl(payload?.xmpp?.websocketUrl),
        },
      };
      setBootstrap(normalizedPayload);
      if (normalizedPayload?.xmpp?.rtc?.bestEffortOnly) {
        appendCallDebugEntry('event', 'RTC läuft im Best-Effort-Modus (TURN unvollständig/evtl. nicht öffentlich).');
      }
      const normalizedPresence = normalizeSelfPresenceFromPayload({
        status: payload?.settings?.presence?.status,
        label: payload?.settings?.presence?.label,
        color: payload?.settings?.presence?.color,
        emoji: payload?.settings?.presence?.emoji,
        expiresAt: payload?.settings?.presence?.expiresAt,
      });
      setSelfPresence(normalizedPresence);
      setPresenceDraft(normalizedPresence);
      const initialPresence: Record<string, PresenceState> = {};
      for (const contact of payload?.contacts || []) {
        if (!contact?.id || contact.id === payload?.me?.id) continue;
        initialPresence[contact.id] = 'offline';
      }
      setPresenceByUserId(initialPresence);
      shouldStickToBottomRef.current = true;
      setShowScrollToBottom(false);

      if (normalizedPayload?.calls?.enabled === false) {
        appendCallDebugEntry('event', 'Sprachanrufe sind für diesen Kontext deaktiviert.');
      }

      const firstId =
        (payload.assistant?.enabled ? payload.assistant?.conversationId : '') ||
        (payload.systemUser?.enabled ? payload.systemUser?.conversationId : '') ||
        payload.contacts?.find((entry) => entry.id !== payload.me.id)?.id ||
        payload.groups?.custom?.[0]?.id ||
        payload.groups?.org?.[0]?.id ||
        '';
      const normalizedFirstId =
        firstId && !firstId.startsWith('direct:') && !firstId.startsWith('org:') && !firstId.startsWith('custom:') && !firstId.startsWith('assistant:') && !firstId.startsWith('system:')
          ? `direct:${firstId}`
          : firstId;
      if (normalizedFirstId) {
        setActiveConversationId((previous) => previous || normalizedFirstId);
      }
    } catch (error: any) {
      setErrorMessage(error?.response?.data?.message || 'Chat-Bootstrap konnte nicht geladen werden.');
    } finally {
      setLoadingBootstrap(false);
    }
  }, [appendCallDebugEntry, headers, chatClientId]);

  const ensureRoomJoined = useCallback(
    async (roomJid: string) => {
      const xmpp = xmppRef.current;
      if (!xmpp || !bootstrap) return;
      const bareRoom = normalizeText(roomJid).split('/')[0];
      if (!bareRoom) return;
      if (joinedRoomsRef.current.has(bareRoom)) return;
      joinedRoomsRef.current.add(bareRoom);
      try {
        await xmpp.send(
          xml(
            'presence',
            { to: `${bareRoom}/${bootstrap.me.username || bootstrap.me.id}` },
            xml('x', { xmlns: 'http://jabber.org/protocol/muc' })
          )
        );
      } catch {
        joinedRoomsRef.current.delete(bareRoom);
      }
    },
    [bootstrap]
  );

  const sendTypingState = useCallback(
    async (conversation: ConversationEntry | null, state: 'composing' | 'paused') => {
      if (!conversation || conversation.type !== 'direct') return;
      const xmpp = xmppRef.current;
      if (!xmpp || connectionState !== 'online') return;
      const lastState = lastTypingStateRef.current[conversation.id];
      if (lastState === state) return;
      try {
        await xmpp.send(
          xml(
            'message',
            { to: conversation.jid, type: 'chat' },
            xml(state, { xmlns: XMPP_NS_CHAT_STATES })
          )
        );
        lastTypingStateRef.current[conversation.id] = state;
      } catch {
        // typing hint is non-critical
      }
    },
    [connectionState]
  );

  const applySelfPresenceToXmpp = useCallback(
    async (settings?: ChatSelfPresenceSettings) => {
      const xmpp = xmppRef.current;
      if (!xmpp || connectionState !== 'online') return;
      const activeSettings = settings || selfPresence;
      const statusLabel = resolveSelfStatusLabel(activeSettings);

      if (activeSettings.status === 'offline') {
        await xmpp.send(
          xml(
            'presence',
            { type: 'unavailable' },
            statusLabel ? xml('status', {}, statusLabel) : undefined
          )
        );
        return;
      }

      const showValue =
        activeSettings.status === 'away'
          ? SELF_STATUS_PRESETS.away.xmppShow
          : activeSettings.status === 'dnd'
          ? SELF_STATUS_PRESETS.dnd.xmppShow
          : undefined;
      const statusEmoji = normalizeText(resolveSelfStatusEmoji(activeSettings));
      const statusText =
        activeSettings.status === 'custom'
          ? [statusEmoji, statusLabel].filter(Boolean).join(' ').trim()
          : '';
      await xmpp.send(
        xml(
          'presence',
          {},
          showValue ? xml('show', {}, showValue) : undefined,
          statusText ? xml('status', {}, statusText) : undefined
        )
      );
    },
    [connectionState, selfPresence]
  );

  const savePresenceSettings = useCallback(
    async (nextPresence: ChatSelfPresenceSettings) => {
      try {
        setPresenceSaving(true);
        setErrorMessage('');
        const response = await axios.patch(
          '/api/admin/chat/presence/self',
          {
            status: nextPresence.status,
            label: nextPresence.status === 'custom' ? normalizeText(nextPresence.label) : '',
            color: nextPresence.status === 'custom' ? sanitizePresenceColor(nextPresence.color, '#0ea5e9') : '',
            emoji: normalizeText(nextPresence.emoji),
            expiresAt: normalizeText(nextPresence.expiresAt) || null,
          },
          { headers }
        );
        const normalized = normalizeSelfPresenceFromPayload({
          status: response.data?.presence?.status,
          label: response.data?.presence?.label,
          color: response.data?.presence?.color,
          emoji: response.data?.presence?.emoji,
          expiresAt: response.data?.presence?.expiresAt,
        });
        setSelfPresence(normalized);
        setPresenceDraft(normalized);
        setPresenceDialogOpen(false);
        if (connectionState === 'online') {
          await applySelfPresenceToXmpp(normalized);
        }
      } catch (error: any) {
        setErrorMessage(error?.response?.data?.message || 'Status konnte nicht gespeichert werden.');
      } finally {
        setPresenceSaving(false);
      }
    },
    [applySelfPresenceToXmpp, connectionState, headers]
  );

  const parseArchiveChatMessage = useCallback(
    (conversation: ConversationEntry, archivedMessage: any, forwardedStamp?: string): ChatMessage | null => {
      if (!bootstrap) return null;
      if (!archivedMessage?.is?.('message')) return null;
      const body = normalizeText(archivedMessage.getChildText?.('body'));
      if (!body) return null;

      const rawFrom = normalizeText(archivedMessage.attrs?.from);
      const stanzaId = normalizeText(archivedMessage.attrs?.id);
      const delayStamp = normalizeText(archivedMessage.getChild?.('delay', XMPP_NS_DELAY)?.attrs?.stamp) || normalizeText(forwardedStamp);
      const createdAtCandidate = delayStamp ? new Date(delayStamp) : new Date();
      const createdAt = Number.isNaN(createdAtCandidate.getTime()) ? new Date().toISOString() : createdAtCandidate.toISOString();

      if (conversation.type === 'group') {
        const senderNick = rawFrom.includes('/') ? normalizeText(rawFrom.split('/')[1]) : 'Gruppe';
        const syntheticId = stanzaId || `mamgrp_${normalizeText(rawFrom + createdAt).replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 64)}`;
        return {
          id: `xmpp:${syntheticId}`,
          senderAdminUserId: '',
          senderDisplayName: senderNick || 'Gruppe',
          conversationId: conversation.id,
          messageKind: 'text',
          body,
          xmppStanzaId: stanzaId || null,
          createdAt,
          quote: null,
          reactions: [],
          readAtByMe: null,
          deliveredByRecipientAt: null,
          readByRecipientAt: null,
          readByCount: 0,
        };
      }

      if (conversation.type !== 'direct') return null;
      const contact = bootstrap.contacts.find((entry) => entry.id === conversation.contactId);
      if (!contact) return null;
      const fromBare = rawFrom.split('/')[0] || rawFrom;
      const fromNode = normalizeText(fromBare.split('@')[0]);
      const meNode = normalizeText((bootstrap.xmpp.jid || '').split('@')[0]);
      const contactNode = normalizeText((contact.jid || '').split('@')[0]);
      if (fromNode !== meNode && fromNode !== contactNode) return null;

      const mine = fromNode === meNode;
      const syntheticId = stanzaId || `mamdir_${normalizeText(rawFrom + createdAt).replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 64)}`;
      return {
        id: `xmpp:${syntheticId}`,
        senderAdminUserId: mine ? bootstrap.me.id : contact.id,
        senderDisplayName: mine ? bootstrap.me.displayName : (contact.displayName || contact.username),
        conversationId: conversation.id,
        messageKind: 'text',
        body,
        xmppStanzaId: stanzaId || null,
        createdAt,
        quote: null,
        reactions: [],
        readAtByMe: null,
        deliveredByRecipientAt: null,
        readByRecipientAt: null,
        readByCount: 0,
      };
    },
    [bootstrap]
  );

  const syncXmppArchiveForConversation = useCallback(
    async (conversation: ConversationEntry, limit = 80) => {
      if (!bootstrap || connectionState !== 'online') return;
      if (conversation.type !== 'direct' && conversation.type !== 'group') return;
      const xmpp = xmppRef.current;
      if (!xmpp) return;

      const queryId = `mamq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const iqId = `iqm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const max = Math.max(20, Math.min(240, Math.floor(limit)));
      const collected: ChatMessage[] = [];

      const stanzaListener = (stanza: any) => {
        if (!stanza?.is?.('message')) return;
        const result = stanza.getChild?.('result', XMPP_NS_MAM);
        if (!result) return;
        if (normalizeText(result.attrs?.queryid) !== queryId) return;
        const forwarded = result.getChild?.('forwarded', XMPP_NS_FORWARD);
        if (!forwarded) return;
        const forwardedStamp = normalizeText(forwarded.getChild?.('delay', XMPP_NS_DELAY)?.attrs?.stamp);
        const forwardedMessage = forwarded.getChild?.('message');
        const parsed = parseArchiveChatMessage(conversation, forwardedMessage, forwardedStamp);
        if (parsed) {
          collected.push(parsed);
        }
      };

      xmpp.on('stanza', stanzaListener);
      setSyncingXmppHistory(true);
      try {
        const dataFormFields = [
          xml(
            'field',
            { var: 'FORM_TYPE', type: 'hidden' },
            xml('value', {}, XMPP_NS_MAM)
          ),
        ];
        if (conversation.type === 'direct') {
          dataFormFields.push(
            xml(
              'field',
              { var: 'with' },
              xml('value', {}, conversation.jid)
            )
          );
        }

        const queryChildren = [
          xml('x', { xmlns: XMPP_NS_DATAFORM, type: 'submit' }, ...dataFormFields),
          xml('set', { xmlns: XMPP_NS_RSM }, xml('max', {}, String(max))),
        ];
        const iqAttributes: Record<string, string> = {
          type: 'set',
          id: iqId,
        };
        if (conversation.type === 'group') {
          iqAttributes.to = normalizeText(conversation.jid).split('/')[0] || conversation.jid;
        }
        await sendXmppIqRequest(
          xml(
            'iq',
            iqAttributes,
            xml('query', { xmlns: XMPP_NS_MAM, queryid: queryId }, ...queryChildren)
          ),
          22000
        );
        if (collected.length > 0) {
          appendMessages(conversation.id, collected);
        }
      } catch (error: any) {
        const msg = normalizeText(error?.message);
        if (msg) {
          setErrorMessage(`XMPP-Verlauf konnte nicht synchronisiert werden: ${msg}`);
        }
      } finally {
        xmpp.removeListener('stanza', stanzaListener);
        setSyncingXmppHistory(false);
      }
    },
    [appendMessages, bootstrap, connectionState, parseArchiveChatMessage, sendXmppIqRequest]
  );

  const connectXmpp = useCallback(async () => {
    if (!bootstrap || !bootstrap.enabled) return;
    if (xmppRef.current) return;

    setConnectionState(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting');
    setConnectionHealthState(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'degraded');
    connectionStateRef.current = reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting';

    const useBoshFallback =
      bootstrap?.connection?.wsBoshFallback === true &&
      reconnectAttemptsRef.current >= 3;
    const serviceUrl = useBoshFallback
      ? resolveXmppBoshFallbackUrl(bootstrap.xmpp.websocketUrl)
      : bootstrap.xmpp.websocketUrl;
    activeTransportRef.current = useBoshFallback ? 'bosh' : 'websocket';

    const xmpp = createXmppClient({
      service: serviceUrl,
      domain: bootstrap.xmpp.domain,
      username: bootstrap.xmpp.username,
      password: bootstrap.xmpp.password,
      resource: bootstrap.xmpp.resource || 'admin',
    });

    xmppRef.current = xmpp;

    xmpp.on('error', () => {
      if (xmppRef.current === xmpp) {
        xmppRef.current = null;
      }
      setErrorMessage('XMPP-Verbindung fehlgeschlagen. Automatischer Reconnect läuft…');
      setConnectionState('error');
      setConnectionHealthState('degraded');
      connectionStateRef.current = 'error';
    });

    xmpp.on('offline', () => {
      if (xmppRef.current === xmpp) {
        xmppRef.current = null;
      }
      if (open) {
        setErrorMessage('XMPP ist offline. Es wird automatisch neu verbunden.');
      }
      setConnectionState(open ? 'error' : 'offline');
      setConnectionHealthState(open ? 'degraded' : 'offline');
      connectionStateRef.current = open ? 'error' : 'offline';
    });

    xmpp.on('online', async () => {
      reconnectAttemptsRef.current = 0;
      setErrorMessage('');
      setConnectionState('online');
      setConnectionHealthState(activeTransportRef.current === 'bosh' ? 'fallback_bosh' : 'online');
      connectionStateRef.current = 'online';
      await applySelfPresenceToXmpp();
      await enableXmppCarbons();
    });

    xmpp.on('stanza', (stanza: any) => {
      try {
        if (stanza?.is?.('presence')) {
          const from = normalizeText(stanza.attrs?.from);
          const type = normalizeText(stanza.attrs?.type).toLowerCase();
          const show = normalizeText(stanza.getChildText?.('show')).toLowerCase();
          const fromBare = from.split('/')[0] || from;
          const node = normalizeText(fromBare.split('@')[0]);
          if (!node) return;

          const contact = bootstrap.contacts.find((entry) => normalizeText(entry.jid.split('@')[0]) === node);
          if (!contact) return;
          const nextPresence: PresenceState =
            type === 'unavailable'
              ? 'offline'
              : show === 'away' || show === 'xa'
                ? 'away'
                : show === 'dnd'
                  ? 'dnd'
                  : 'online';
          setPresenceByUserId((prev) => ({
            ...prev,
            [contact.id]: nextPresence,
          }));
          return;
        }

        if (stanza?.is?.('iq')) {
          const iqId = normalizeText(stanza.attrs?.id);
          if (!iqId) return;
          const pending = pendingIqRequestsRef.current.get(iqId);
          if (!pending) return;
          pendingIqRequestsRef.current.delete(iqId);
          window.clearTimeout(pending.timer);
          if (normalizeText(stanza.attrs?.type).toLowerCase() === 'error') {
            pending.reject(new Error('XMPP IQ Fehler'));
          } else {
            pending.resolve(stanza);
          }
          return;
        }

        if (!stanza?.is?.('message')) return;

        const type = String(stanza.attrs?.type || 'chat');
        const from = String(stanza.attrs?.from || '');
        const stanzaId = String(stanza.attrs?.id || '');
        const body = String(stanza.getChildText?.('body') || '').trim();
        const hasComposing = !!stanza.getChild?.('composing', XMPP_NS_CHAT_STATES);
        const hasPaused = !!stanza.getChild?.('paused', XMPP_NS_CHAT_STATES);

        if (type === 'groupchat') {
          const roomJid = from.split('/')[0];
          const senderNick = from.includes('/') ? from.split('/')[1] : '';
          const group = groupConversations.find((entry) => entry.jid === roomJid);
          if (!group) return;
          if (normalizeText(senderNick) === normalizeText(bootstrap.me.username)) return;

          if (!body) return;
          const createdAt = getStanzaTimestamp(stanza);
          appendMessages(group.id, [
            {
              id: `xmpp:${stanzaId || Date.now()}`,
              senderAdminUserId: '',
              senderDisplayName: senderNick || 'Gruppe',
              conversationId: group.id,
              messageKind: 'text',
              body,
              xmppStanzaId: stanzaId || null,
              createdAt,
              quote: null,
              reactions: [],
              readAtByMe: null,
              deliveredByRecipientAt: null,
              readByRecipientAt: null,
              readByCount: 0,
            },
          ]);

          if (open && activeConversationId === group.id && document.visibilityState === 'visible') {
            void markConversationRead(group.id);
          } else {
            showBrowserNotification({
              title: `${group.label} · neue Nachricht`,
              body: `${senderNick || 'Gruppe'}: ${body.slice(0, 140)}`,
              conversationId: group.id,
            });
          }
          return;
        }

        const bareFrom = from.split('/')[0];
        const fromNode = normalizeText(bareFrom.split('@')[0]);
        const contact = bootstrap.contacts.find((entry) => normalizeText(entry.jid.split('@')[0]) === fromNode);
        if (!contact) return;
        const conversationId = `direct:${contact.id}`;

        const proposedCall = stanza.getChild?.('propose', XMPP_NS_JMI);
        const acceptedCall = stanza.getChild?.('accept', XMPP_NS_JMI);
        const rejectedCall = stanza.getChild?.('reject', XMPP_NS_JMI);
        const finishedCall = stanza.getChild?.('finish', XMPP_NS_JMI) || stanza.getChild?.('retract', XMPP_NS_JMI);
        const webRtcSignal = stanza.getChild?.('signal', XMPP_NS_WEBRTC);
        if (proposedCall) {
          const callId = normalizeText(proposedCall.attrs?.id);
          if (!callId) return;
          const proposedMediaType =
            normalizeText(proposedCall.getChild?.('description', 'urn:xmpp:jingle:apps:rtp:1')?.attrs?.media).toLowerCase() ===
            'video'
              ? 'video'
              : 'audio';
          if (!callsEnabled) {
            void sendXmppCallMessage(contact.jid, xml('reject', { xmlns: XMPP_NS_JMI, id: callId }));
            return;
          }
          if (callSessionRef.current && callSessionRef.current.state !== 'ended' && callSessionRef.current.state !== 'failed') {
            void sendXmppCallMessage(contact.jid, xml('reject', { xmlns: XMPP_NS_JMI, id: callId }));
            return;
          }
          const fromResource = normalizeText(from.includes('/') ? from.split('/')[1] : '');
          setIncomingCall({
            callId,
            conversationId,
            fromJid: bareFrom,
            fromLabel: contact.displayName || contact.username || 'Kontakt',
            fromAdminUserId: contact.id,
            fromResource,
            mediaType: proposedMediaType,
            createdAt: Date.now(),
          });
          setCallStatusText(
            proposedMediaType === 'video'
              ? `Eingehender Videoanruf von ${contact.displayName || contact.username || 'Kontakt'}`
              : `Eingehender Anruf von ${contact.displayName || contact.username || 'Kontakt'}`
          );
          showBrowserNotification({
            title: `Anruf eingehend`,
            body: `${contact.displayName || contact.username || 'Kontakt'} möchte mit dir sprechen`,
            conversationId,
          });
          return;
        }

        if (rejectedCall) {
          const callId = normalizeText(rejectedCall.attrs?.id);
          const session = callSessionRef.current;
          if (session && session.callId === callId) {
            cleanupCallMedia();
            setCallStatusText('Anruf abgelehnt');
            setCallSession({ ...session, state: 'failed' });
            void releaseCallClaim(callId, 'failed', { mediaTypeFinal: session.mediaType, endedReason: 'peer_rejected' });
          }
          return;
        }

        if (finishedCall) {
          const callId = normalizeText(finishedCall.attrs?.id);
          const session = callSessionRef.current;
          if (session && session.callId === callId) {
            cleanupCallMedia();
            setCallStatusText('Anruf beendet');
            setCallSession({ ...session, state: 'ended' });
            void releaseCallClaim(callId, 'ended', { mediaTypeFinal: session.mediaType, endedReason: 'peer_finished' });
          }
          if (incomingCallRef.current && incomingCallRef.current.callId === callId) {
            setIncomingCall(null);
          }
          return;
        }

        if (acceptedCall) {
          const callId = normalizeText(acceptedCall.attrs?.id);
          const session = callSessionRef.current;
          if (!session || session.callId !== callId || !session.startedByMe) return;
          void (async () => {
            try {
              setCallStatusText('Verbindung wird aufgebaut…');
              setCallSession((current) =>
                current && current.callId === session.callId ? { ...current, state: 'connecting' } : current
              );
              const stream = await ensureLocalAudioStream();
              const pc = peerConnectionRef.current || createPeerConnectionForSession(session, stream);
              const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: session.requestedMediaType === 'video',
              });
              await pc.setLocalDescription(offer);
              await sendWebRtcSignal(session.targetJid, session.callId, 'offer', { sdp: offer.sdp || '' });
            } catch (error: any) {
              cleanupCallMedia();
              setCallStatusText('Anruf konnte nicht aufgebaut werden');
              setCallSession((current) =>
                current && current.callId === session.callId ? { ...current, state: 'failed' } : current
              );
              void releaseCallClaim(session.callId, 'failed', {
                mediaTypeFinal: session.mediaType,
                endedReason: 'offer_failed',
              });
              const errorMessage = normalizeText(error?.message);
              if (errorMessage) setErrorMessage(errorMessage);
            }
          })();
          return;
        }

        if (webRtcSignal) {
          const callId = normalizeText(webRtcSignal.attrs?.call);
          const signalType = normalizeText(webRtcSignal.attrs?.type).toLowerCase();
          if (!callId || !signalType) return;
          const sdp = String(webRtcSignal.getChildText?.('sdp') || '');
          const candidateRaw = String(webRtcSignal.getChildText?.('candidate') || '');

          void (async () => {
            try {
              let session = callSessionRef.current;
              if (!session || session.callId !== callId) {
                const pendingIncoming = incomingCallRef.current;
                if (!pendingIncoming || pendingIncoming.callId !== callId) {
                  return;
                }
                const freshSession: ChatCallSession = {
                  callId,
                  conversationId,
                  targetJid: contact.jid,
                  startedByMe: false,
                  startedAt: Date.now(),
                  state: 'connecting',
                  mediaType: 'audio',
                  requestedMediaType: 'audio',
                  videoState: 'off',
                  clientConnectionId: chatClientId,
                  upgradeAllowed: bootstrap?.calls?.media?.upgradeSupported !== false,
                };
                setIncomingCall(null);
                setCallSession(freshSession);
                session = freshSession;
              }
              const stream = await ensureLocalAudioStream();
              const pc = peerConnectionRef.current || createPeerConnectionForSession(session, stream);

              if (signalType === 'offer' && normalizeText(sdp)) {
                await pc.setRemoteDescription({ type: 'offer', sdp });
                if (detectVideoInSdp(sdp)) {
                  void updateCallMediaState(callId, {
                    mediaType: 'video',
                    requestedMediaType: 'video',
                    upgradeState: 'remote_offer_video',
                  });
                  setCallSession((current) =>
                    current && current.callId === session.callId
                      ? { ...current, requestedMediaType: 'video', mediaType: 'video', videoState: 'requesting' }
                      : current
                  );
                }
                const queued = [...pendingRemoteCandidatesRef.current];
                pendingRemoteCandidatesRef.current = [];
                for (const candidate of queued) {
                  await pc.addIceCandidate(candidate);
                }
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await sendWebRtcSignal(session.targetJid, session.callId, 'answer', { sdp: answer.sdp || '' });
                setCallSession((current) =>
                  current && current.callId === session.callId
                    ? {
                        ...current,
                        state: 'active',
                        mediaType: detectVideoInSdp(sdp) ? 'video' : current.mediaType,
                        requestedMediaType: detectVideoInSdp(sdp) ? 'video' : current.requestedMediaType,
                        videoState: detectVideoInSdp(sdp) ? 'on' : current.videoState,
                      }
                    : current
                );
                setCallStatusText('Verbunden');
                return;
              }

              if (signalType === 'answer' && normalizeText(sdp)) {
                await pc.setRemoteDescription({ type: 'answer', sdp });
                const answerHasVideo = detectVideoInSdp(sdp);
                if (answerHasVideo) {
                  void updateCallMediaState(callId, {
                    mediaType: 'video',
                    requestedMediaType: 'video',
                    upgradeState: 'answer_contains_video',
                  });
                }
                const queued = [...pendingRemoteCandidatesRef.current];
                pendingRemoteCandidatesRef.current = [];
                for (const candidate of queued) {
                  await pc.addIceCandidate(candidate);
                }
                setCallSession((current) =>
                  current && current.callId === session.callId
                    ? {
                        ...current,
                        state: 'active',
                        mediaType: answerHasVideo ? 'video' : current.mediaType,
                        requestedMediaType: answerHasVideo ? 'video' : current.requestedMediaType,
                        videoState: answerHasVideo ? 'on' : current.videoState,
                      }
                    : current
                );
                setCallStatusText('Verbunden');
                return;
              }

              if (signalType === 'ice' && normalizeText(candidateRaw)) {
                const parsedCandidate = JSON.parse(candidateRaw) as RTCIceCandidateInit;
                if (pc.remoteDescription) {
                  await pc.addIceCandidate(parsedCandidate);
                } else {
                  pendingRemoteCandidatesRef.current.push(parsedCandidate);
                }
              }
            } catch (error: any) {
              cleanupCallMedia();
              setCallSession((current) =>
                current && current.callId === callId ? { ...current, state: 'failed' } : current
              );
              setCallStatusText('Anrufverbindung fehlgeschlagen');
              void releaseCallClaim(callId, 'failed', {
                mediaTypeFinal: callSessionRef.current?.mediaType || 'audio',
                endedReason: 'signal_processing_failed',
              });
              const errorMessage = normalizeText(error?.message);
              if (errorMessage) {
                setErrorMessage(errorMessage);
              }
            }
          })();
          return;
        }

        const receiptId = normalizeText(stanza.getChild?.('received', XMPP_NS_RECEIPTS)?.attrs?.id);
        const markerReceivedId = normalizeText(stanza.getChild?.('received', XMPP_NS_CHAT_MARKERS)?.attrs?.id);
        const markerDisplayedId = normalizeText(stanza.getChild?.('displayed', XMPP_NS_CHAT_MARKERS)?.attrs?.id);
        const markerStamp = getStanzaTimestamp(stanza);
        if (receiptId) {
          applyMessagePatchByStanzaId(conversationId, receiptId, {
            deliveredByRecipientAt: markerStamp,
          });
          return;
        }
        if (markerReceivedId) {
          applyMessagePatchByStanzaId(conversationId, markerReceivedId, {
            deliveredByRecipientAt: markerStamp,
          });
          return;
        }
        if (markerDisplayedId) {
          applyMessagePatchByStanzaId(conversationId, markerDisplayedId, {
            deliveredByRecipientAt: markerStamp,
            readByRecipientAt: markerStamp,
          });
          return;
        }

        if (!body && (hasComposing || hasPaused)) {
          if (hasComposing) {
            setTypingByConversation((prev) => ({
              ...prev,
              [conversationId]: contact.displayName || contact.username || 'Benutzer',
            }));
            window.setTimeout(() => {
              setTypingByConversation((prev) => {
                if (prev[conversationId] !== (contact.displayName || contact.username || 'Benutzer')) return prev;
                const next = { ...prev };
                delete next[conversationId];
                return next;
              });
            }, 4000);
          }
          if (hasPaused) {
            setTypingByConversation((prev) => {
              if (!prev[conversationId]) return prev;
              const next = { ...prev };
              delete next[conversationId];
              return next;
            });
          }
          return;
        }

        if (!body) return;

        const wantsReceipt = !!stanza.getChild?.('request', XMPP_NS_RECEIPTS);
        if (wantsReceipt && normalizeText(stanzaId)) {
          void sendXmppStanzaSafe(
            xml(
              'message',
              { to: bareFrom, type: 'chat' },
              xml('received', { xmlns: XMPP_NS_RECEIPTS, id: stanzaId })
            ),
            { strict: false, context: 'XMPP-Receipt' }
          );
        }
        if (normalizeText(stanzaId)) {
          void sendXmppStanzaSafe(
            xml(
              'message',
              { to: bareFrom, type: 'chat' },
              xml('received', { xmlns: XMPP_NS_CHAT_MARKERS, id: stanzaId })
            ),
            { strict: false, context: 'XMPP-Marker' }
          );
        }

        const createdAt = getStanzaTimestamp(stanza);
        appendMessages(conversationId, [
          {
            id: `xmpp:${stanzaId || Date.now()}`,
            senderAdminUserId: contact.id,
            senderDisplayName: contact.displayName || contact.username,
            conversationId,
            messageKind: 'text',
            body,
            xmppStanzaId: stanzaId || null,
            createdAt,
            quote: null,
            reactions: [],
            readAtByMe: null,
            deliveredByRecipientAt: null,
            readByRecipientAt: null,
            readByCount: 0,
          },
        ]);

        if (open && activeConversationId === conversationId && document.visibilityState === 'visible') {
          void markConversationRead(conversationId);
        } else {
          showBrowserNotification({
            title: `${contact.displayName || contact.username} · neue Nachricht`,
            body: body.slice(0, 160),
            conversationId,
          });
        }
      } catch {
        // ignore malformed stanzas
      }
    });

    try {
      await xmpp.start();
    } catch {
      if (xmppRef.current === xmpp) {
        xmppRef.current = null;
      }
      setErrorMessage('XMPP konnte nicht gestartet werden. Reconnect wird erneut versucht.');
      setConnectionState('error');
      setConnectionHealthState('degraded');
      connectionStateRef.current = 'error';
    }
  }, [
    activeConversationId,
    applyMessagePatchByStanzaId,
    applySelfPresenceToXmpp,
    appendMessages,
    bootstrap,
    callsEnabled,
    cleanupCallMedia,
    createPeerConnectionForSession,
    enableXmppCarbons,
    ensureLocalAudioStream,
    groupConversations,
    chatClientId,
    markConversationRead,
    open,
    sendWebRtcSignal,
    sendXmppCallMessage,
    updateCallMediaState,
    releaseCallClaim,
    sendXmppStanzaSafe,
    showBrowserNotification,
  ]);

  const disconnectXmpp = useCallback(async () => {
    clearReconnectTimer();
    clearPingTimer();
    const xmpp = xmppRef.current;
    if (xmpp) {
      try {
        await xmpp.stop();
      } catch {
        // ignore
      }
    }
    xmppRef.current = null;
    joinedRoomsRef.current.clear();
    for (const pending of pendingIqRequestsRef.current.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('XMPP getrennt'));
    }
    pendingIqRequestsRef.current.clear();
    const activeCall = callSessionRef.current;
    if (activeCall?.callId) {
      void releaseCallClaim(activeCall.callId, 'cancelled', {
        mediaTypeFinal: activeCall.mediaType,
        endedReason: 'xmpp_disconnect',
      });
    }
    cleanupCallMedia();
    setIncomingCall(null);
    setCallSession(null);
    setCallStatusText('');
    setConnectionState('offline');
    setConnectionHealthState('offline');
    connectionStateRef.current = 'offline';
  }, [cleanupCallMedia, clearPingTimer, clearReconnectTimer, releaseCallClaim]);

  const loadMessages = useCallback(
    async (conversationId: string, options?: { silent?: boolean }) => {
      if (!conversationId) return;
      const silent = !!options?.silent;
      if (!silent) {
        setLoadingMessages(true);
      }
      try {
        const response = await axios.get('/api/admin/chat/messages', {
          headers,
          params: {
            conversationId,
            limit: 180,
            _ts: Date.now(),
          },
        });
        const items = Array.isArray(response.data?.items) ? response.data.items : [];
        setMessagesByConversation((prev) => ({
          ...prev,
          [conversationId]: items,
        }));
      } catch (error: any) {
        setErrorMessage(error?.response?.data?.message || 'Nachrichten konnten nicht geladen werden.');
      } finally {
        if (!silent) {
          setLoadingMessages(false);
        }
      }
    },
    [headers]
  );

  const persistCallEventMessage = useCallback(
    async (session: ChatCallSession, statusTextOverride?: string) => {
      const conversationId = normalizeText(session?.conversationId);
      const callId = normalizeText(session?.callId);
      if (!conversationId || !callId) return;
      if (callHistoryLoggedRef.current.has(callId)) return;

      callHistoryLoggedRef.current.add(callId);
      if (callHistoryLoggedRef.current.size > 500) {
        const oldest = callHistoryLoggedRef.current.values().next().value;
        if (oldest) {
          callHistoryLoggedRef.current.delete(oldest);
        }
      }

      const statusText =
        normalizeText(statusTextOverride) || (session.state === 'failed' ? 'Anruf nicht verbunden' : 'Anruf beendet');
      const modeText = session.mediaType === 'video' ? 'Videoanruf' : 'Anruf';
      const directionText = session.startedByMe ? `Ausgehender ${modeText}` : `Eingehender ${modeText}`;
      const durationLabel = formatCallDuration(Date.now() - Number(session.startedAt || Date.now()));
      const body = `📞 ${directionText} · ${statusText}\nDauer: ${durationLabel}`;

      try {
        const response = await axios.post(
          '/api/admin/chat/messages',
          {
            conversationId,
            messageKind: 'call_event',
            body,
          },
          { headers }
        );
        const item = response.data?.item as ChatMessage | undefined;
        if (item) {
          appendMessages(conversationId, [item]);
        } else {
          void loadMessages(conversationId, { silent: true });
        }
      } catch {
        // keep call UX resilient if call-history write fails
      }
    },
    [appendMessages, headers, loadMessages]
  );

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (!bootstrap?.enabled) {
      void disconnectXmpp();
      return;
    }

    if (connectionState === 'online' || connectionState === 'connecting' || connectionState === 'reconnecting') {
      return;
    }

    clearReconnectTimer();
    const attempt = Math.min(8, reconnectAttemptsRef.current + 1);
    reconnectAttemptsRef.current = attempt;
    const baseDelayMs = attempt <= 1 ? 0 : Math.min(20000, 600 * Math.pow(2, attempt - 2));
    const jitterMs = baseDelayMs <= 0 ? 0 : Math.floor(baseDelayMs * Math.random() * 0.35);
    const delayMs = baseDelayMs + jitterMs;

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      void connectXmpp();
    }, delayMs);

    return () => clearReconnectTimer();
  }, [bootstrap?.enabled, connectXmpp, connectionState, disconnectXmpp, clearReconnectTimer]);

  useEffect(() => {
    if (connectionState !== 'online') return;
    void applySelfPresenceToXmpp();
  }, [applySelfPresenceToXmpp, connectionState, selfPresence]);

  useEffect(() => {
    if (!bootstrap) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void sendPresenceHeartbeat({ silent: true });
    };
    tick();
    const visible = document.visibilityState === 'visible';
    const intervalMs = visible ? CHAT_PRESENCE_HEARTBEAT_VISIBLE_MS : CHAT_PRESENCE_HEARTBEAT_HIDDEN_MS;
    const timer = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [bootstrap, sendPresenceHeartbeat]);

  useEffect(() => {
    if (!bootstrap) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void refreshPresenceSnapshot({ silent: true });
    };
    tick();
    const visible = document.visibilityState === 'visible';
    const intervalMs = visible ? CHAT_PRESENCE_SNAPSHOT_VISIBLE_MS : CHAT_PRESENCE_SNAPSHOT_HIDDEN_MS;
    const timer = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [bootstrap, refreshPresenceSnapshot]);

  useEffect(() => {
    if (connectionState !== 'online') {
      clearPingTimer();
      setXmppLatencyMs(null);
      return;
    }
    clearPingTimer();
    void sendXmppPing();
    pingTimerRef.current = window.setInterval(() => {
      void sendXmppPing();
    }, XMPP_PING_INTERVAL_MS);
    return () => clearPingTimer();
  }, [clearPingTimer, connectionState, sendXmppPing]);

  useEffect(() => {
    if (selfPresence.status === 'online') return;
    const expiresAtIso = normalizeText(selfPresence.expiresAt);
    if (!expiresAtIso) return;
    const expiresAt = new Date(expiresAtIso).getTime();
    if (!Number.isFinite(expiresAt)) return;

    const resetStatus = () => {
      const nextPresence: ChatSelfPresenceSettings = {
        status: 'online',
        label: '',
        color: SELF_STATUS_PRESETS.online.color,
        emoji: SELF_STATUS_PRESETS.online.emoji,
        expiresAt: null,
      };
      void savePresenceSettings(nextPresence);
    };

    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      resetStatus();
      return;
    }

    const timer = window.setTimeout(resetStatus, Math.min(remainingMs + 1200, 2147483647));
    return () => window.clearTimeout(timer);
  }, [selfPresence, savePresenceSettings]);

  useEffect(
    () => () => {
      void disconnectXmpp();
    },
    [disconnectXmpp]
  );

  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    for (const track of stream.getAudioTracks()) {
      track.enabled = !callMuted;
    }
  }, [callMuted]);

  useEffect(() => {
    if (!remoteAudioRef.current) return;
    remoteAudioRef.current.muted = callSpeakerMuted;
    if (!callSpeakerMuted) {
      void resumeRemoteAudioPlayback({ silenceError: true });
    } else {
      setCallNeedsAudioUnlock(false);
    }
  }, [callSpeakerMuted, resumeRemoteAudioPlayback]);

  useEffect(() => {
    void refreshAudioOutputDevices();
    if (!navigator?.mediaDevices) return;
    const mediaDevices = navigator.mediaDevices as MediaDevices & {
      addEventListener?: (type: 'devicechange', listener: () => void) => void;
      removeEventListener?: (type: 'devicechange', listener: () => void) => void;
      ondevicechange?: (() => void) | null;
    };
    const handleDeviceChange = () => {
      void refreshAudioOutputDevices();
    };

    if (typeof mediaDevices.addEventListener === 'function' && typeof mediaDevices.removeEventListener === 'function') {
      mediaDevices.addEventListener('devicechange', handleDeviceChange);
      return () => {
        mediaDevices.removeEventListener?.('devicechange', handleDeviceChange);
      };
    }

    const previousHandler = mediaDevices.ondevicechange || null;
    mediaDevices.ondevicechange = handleDeviceChange;
    return () => {
      mediaDevices.ondevicechange = previousHandler;
    };
  }, [refreshAudioOutputDevices]);

  useEffect(() => {
    if (!callSession || callSpeakerMuted) return;
    const resume = () => {
      void resumeRemoteAudioPlayback({ silenceError: true });
      const remoteVideo = remoteVideoRef.current;
      if (remoteVideo && remoteVideo.srcObject) {
        void remoteVideo.play().catch(() => undefined);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') resume();
    };
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [callSession, callSpeakerMuted, resumeRemoteAudioPlayback]);

  useEffect(() => {
    if (!callSession) return;
    void applyAudioOutputDevice(selectedAudioOutputId);
  }, [applyAudioOutputDevice, callSession, selectedAudioOutputId]);

  useEffect(() => {
    if (!callSession || callSession.state !== 'active') {
      clearRemoteTrackTimeout();
      return;
    }
    const callId = normalizeText(callSession.callId);
    if (!callId) return;
    if (remoteTrackCallIdRef.current !== callId) {
      remoteTrackCallIdRef.current = callId;
      remoteTrackReceivedRef.current = false;
    }
    clearRemoteTrackTimeout();
    remoteTrackTimeoutRef.current = window.setTimeout(() => {
      const active = callSessionRef.current;
      if (!active || active.callId !== callId) return;
      if (remoteTrackReceivedRef.current) return;
      appendCallDebugEntry('error', 'Timeout: kein Remote-Audio-Track empfangen');
      setCallStatusText('Verbunden, aber kein Remote-Audio · bitte erneut anrufen');
      setErrorMessage('Kein Audio vom Gegenüber erkannt. Bitte Audio aktivieren oder den Anruf neu starten.');
      cleanupCallMedia();
      setCallSession((current) =>
        current && current.callId === callId ? { ...current, state: 'failed' } : current
      );
      void releaseCallClaim(callId, 'failed', {
        mediaTypeFinal: callSessionRef.current?.mediaType || 'audio',
        endedReason: 'remote_track_timeout',
      });
    }, CALL_REMOTE_TRACK_TIMEOUT_MS);
    return () => {
      clearRemoteTrackTimeout();
    };
  }, [appendCallDebugEntry, callSession, cleanupCallMedia, clearRemoteTrackTimeout, releaseCallClaim]);

  const endCurrentCall = useCallback(
    async (reason: 'finish' | 'reject' = 'finish', notifyPeer = true) => {
      const active = callSessionRef.current;
      appendCallDebugEntry('event', `Call wird beendet (${reason})`);
      if (notifyPeer && active) {
        try {
          await sendXmppCallMessage(
            active.targetJid,
            xml(reason, { xmlns: XMPP_NS_JMI, id: active.callId })
          );
        } catch {
          // best effort
        }
      }
      cleanupCallMedia();
      setCallSession((current) => (current ? { ...current, state: 'ended' } : null));
      setIncomingCall(null);
      setCallStatusText('Anruf beendet');
      if (active?.callId) {
        void releaseCallClaim(active.callId, reason === 'reject' ? 'rejected' : 'ended', {
          mediaTypeFinal: active.mediaType,
          endedReason: reason === 'reject' ? 'rejected_by_local_user' : 'ended_by_local_user',
        });
      }
    },
    [appendCallDebugEntry, cleanupCallMedia, sendXmppCallMessage, releaseCallClaim]
  );

  useEffect(() => {
    const mediaSession = (navigator as Navigator & { mediaSession?: any }).mediaSession;
    if (!mediaSession) return;

    const setAction = (action: string, handler: (() => void) | null) => {
      try {
        mediaSession.setActionHandler(action as any, handler as any);
      } catch {
        // ignore unsupported actions
      }
    };
    const clearActions = () => {
      setAction('play', null);
      setAction('pause', null);
      setAction('stop', null);
      setAction('hangup', null);
    };

    const active = callSessionRef.current;
    const isActiveCall = !!active && active.state !== 'ended' && active.state !== 'failed';
    if (!isActiveCall) {
      clearActions();
      try {
        mediaSession.metadata = null;
      } catch {
        // ignore
      }
      try {
        mediaSession.playbackState = 'none';
      } catch {
        // ignore
      }
      return;
    }

    const peerLabel = normalizeText(activeCallConversation?.label) || 'Kontakt';
    const metadataTitle = `Anruf mit ${peerLabel}`;
    const metadataArtist = normalizeText(callStatusText) || 'behebes Teamchat';
    try {
      if (typeof MediaMetadata !== 'undefined') {
        mediaSession.metadata = new MediaMetadata({
          title: metadataTitle,
          artist: metadataArtist,
          album: 'behebes',
        });
      }
    } catch {
      // ignore metadata failures
    }
    try {
      mediaSession.playbackState = callSpeakerMuted ? 'paused' : 'playing';
    } catch {
      // ignore
    }

    setAction('play', () => {
      setCallSpeakerMuted(false);
      void resumeRemoteAudioPlayback({ silenceError: true });
    });
    setAction('pause', () => {
      setCallSpeakerMuted(true);
    });
    setAction('stop', () => {
      void endCurrentCall('finish', true);
    });
    setAction('hangup', () => {
      void endCurrentCall('finish', true);
    });

    return () => {
      clearActions();
    };
  }, [activeCallConversation?.label, callSpeakerMuted, callStatusText, endCurrentCall, resumeRemoteAudioPlayback]);

  useEffect(() => {
    if (!callSession) return;
    if (callSession.state !== 'ended' && callSession.state !== 'failed') return;
    void persistCallEventMessage(callSession, callStatusText);
    const timer = window.setTimeout(() => {
      setCallSession((current) =>
        current && current.callId === callSession.callId ? null : current
      );
      setCallStatusText('');
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [callSession, callStatusText, persistCallEventMessage]);

  useEffect(() => {
    if (!open || !activeConversationId) return;
    void loadMessages(activeConversationId);
  }, [open, activeConversationId, loadMessages]);

  useEffect(() => {
    if (!open || connectionState !== 'online' || !activeConversation) return;
    if (activeConversation.type !== 'direct' && activeConversation.type !== 'group') return;
    if (autoArchiveSyncedRef.current.has(activeConversation.id)) return;
    const existingItems = messagesByConversation[activeConversation.id] || [];
    if (existingItems.length >= 20) return;
    autoArchiveSyncedRef.current.add(activeConversation.id);
    void syncXmppArchiveForConversation(activeConversation, 120);
  }, [activeConversation, connectionState, messagesByConversation, open, syncXmppArchiveForConversation]);

  useEffect(() => {
    setMessageSearch('');
  }, [activeConversationId]);

  useEffect(() => {
    if (!activeConversation || activeConversation.type !== 'group') return;
    if (connectionState !== 'online') return;
    void ensureRoomJoined(activeConversation.jid);
  }, [activeConversation, connectionState, ensureRoomJoined]);

  useEffect(() => {
    if (!open || !activeConversationId) return;
    if (document.visibilityState !== 'visible') return;
    void markConversationRead(activeConversationId);
  }, [open, activeConversationId, markConversationRead]);

  useEffect(() => {
    if (!open || !activeConversationId) return;

    let cancelled = false;
    const degraded = connectionState !== 'online';
    const tick = () => {
      if (cancelled) return;
      const isVisible = document.visibilityState === 'visible';
      if (!isVisible && !detachedView && degraded) return;
      if (!degraded && !isVisible) return;
      void loadMessages(activeConversationId, { silent: true });
      if (isVisible) {
        void markConversationRead(activeConversationId);
      }
    };

    const isVisibleNow = document.visibilityState === 'visible';
    const intervalMs = degraded
      ? isVisibleNow
        ? CHAT_REFRESH_VISIBLE_MS
        : CHAT_REFRESH_HIDDEN_MS
      : isVisibleNow
      ? 22000
      : 90000;
    const timer = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, activeConversationId, detachedView, loadMessages, markConversationRead, connectionState]);

  useEffect(() => {
    if (!open || !activeConversationId) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void loadMessages(activeConversationId, { silent: true });
      void markConversationRead(activeConversationId);
    };
    window.document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [open, activeConversationId, loadMessages, markConversationRead]);

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    setBrowserPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!browserNotifyEnabled) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      void requestBrowserNotificationPermission();
    }
  }, [open, browserNotifyEnabled, requestBrowserNotificationPermission]);

  useEffect(() => {
    if (!activeConversation || activeConversation.type !== 'direct') return;

    const hasContent = normalizeText(draft).length > 0;
    const conversationId = activeConversation.id;

    if (hasContent) {
      void sendTypingState(activeConversation, 'composing');
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
      }
      typingStopTimerRef.current = window.setTimeout(() => {
        void sendTypingState(activeConversation, 'paused');
      }, 1600);
    } else {
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }
      void sendTypingState(activeConversation, 'paused');
    }

    return () => {
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = null;
      }
      const state = lastTypingStateRef.current[conversationId];
      if (state === 'composing') {
        void sendTypingState(activeConversation, 'paused');
      }
    };
  }, [activeConversation, draft, sendTypingState]);

  const handleSelectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    setTypingByConversation((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  };

  const openCallConversation = () => {
    const active = callSessionRef.current;
    if (!active) return;
    const conversationId = normalizeText(active.conversationId);
    if (!conversationId) return;

    if (hideLauncher) {
      navigate(`/messenger/${encodeURIComponent(conversationId)}`);
      return;
    }

    setOpen(true);
    handleSelectConversation(conversationId);
  };

  const openEmojiMenu = (event: React.MouseEvent<HTMLElement>) => {
    setEmojiMenuAnchorEl(event.currentTarget);
  };

  const closeEmojiMenu = () => {
    setEmojiMenuAnchorEl(null);
  };

  const insertEmojiIntoDraft = (emoji: string) => {
    setDraft((current) => `${current}${emoji}`);
    setEmojiMenuAnchorEl(null);
  };

  const handleDeleteCustomGroup = async (group: ChatGroup) => {
    const customGroupId = normalizeText(group?.customGroupId);
    if (!customGroupId) return;
    if (!window.confirm(`Freie Gruppe "${group.name}" wirklich löschen?`)) return;
    try {
      await axios.delete(`/api/admin/chat/groups/custom/${encodeURIComponent(customGroupId)}`, {
        headers,
      });
      setBootstrap((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          groups: {
            ...prev.groups,
            custom: (prev.groups?.custom || []).filter((entry) => normalizeText(entry?.customGroupId) !== customGroupId),
          },
        };
      });
      setMessagesByConversation((prev) => {
        const next = { ...prev };
        delete next[`custom:${customGroupId}`];
        return next;
      });
      if (activeConversationId === `custom:${customGroupId}`) {
        const fallback =
          directConversations[0]?.id ||
          groupConversations.find((entry) => entry.id !== `custom:${customGroupId}`)?.id ||
          '';
        setActiveConversationId(fallback);
      }
    } catch (error: any) {
      setErrorMessage(error?.response?.data?.message || 'Gruppe konnte nicht gelöscht werden.');
    }
  };

  const applyReactionsToMessage = useCallback((conversationId: string, messageId: string, reactions: ChatReaction[]) => {
    if (!conversationId || !messageId) return;
    setMessagesByConversation((prev) => {
      const items = prev[conversationId] || [];
      if (items.length === 0) return prev;
      const nextItems = items.map((entry) =>
        entry.id === messageId
          ? {
              ...entry,
              reactions: Array.isArray(reactions) ? reactions : [],
            }
          : entry
      );
      return {
        ...prev,
        [conversationId]: nextItems,
      };
    });
  }, []);

  const toggleReaction = useCallback(
    async (message: ChatMessage, emoji: string) => {
      if (!activeConversation) return;
      const messageId = normalizeText(message?.id);
      const normalizedEmoji = normalizeText(emoji).slice(0, 32);
      if (!messageId || !normalizedEmoji) return;

      const alreadyReacted = !!(message.reactions || []).find(
        (entry) => entry.emoji === normalizedEmoji && entry.reactedByMe
      );
      try {
        if (alreadyReacted) {
          const response = await axios.delete(`/api/admin/chat/messages/${encodeURIComponent(messageId)}/reactions`, {
            headers,
            data: {
              conversationId: activeConversation.id,
              emoji: normalizedEmoji,
            },
          });
          applyReactionsToMessage(activeConversation.id, messageId, response.data?.reactions || []);
        } else {
          const response = await axios.post(
            `/api/admin/chat/messages/${encodeURIComponent(messageId)}/reactions`,
            {
              conversationId: activeConversation.id,
              emoji: normalizedEmoji,
            },
            { headers }
          );
          applyReactionsToMessage(activeConversation.id, messageId, response.data?.reactions || []);
        }
      } catch (error: any) {
        setErrorMessage(error?.response?.data?.message || 'Reaktion konnte nicht aktualisiert werden.');
      }
    },
    [activeConversation, applyReactionsToMessage, headers]
  );

  const openReactionMenu = (event: React.MouseEvent<HTMLElement>, messageId: string) => {
    setReactionMenuAnchorEl(event.currentTarget);
    setReactionTargetMessageId(normalizeText(messageId));
  };

  const closeReactionMenu = () => {
    setReactionMenuAnchorEl(null);
    setReactionTargetMessageId('');
  };

  const handleReactionEmojiPick = async (emoji: string) => {
    const messageId = normalizeText(reactionTargetMessageId);
    if (!messageId) {
      closeReactionMenu();
      return;
    }
    const target = activeMessages.find((entry) => normalizeText(entry.id) === messageId);
    closeReactionMenu();
    if (!target) return;
    await toggleReaction(target, emoji);
  };

  const sendMessage = useCallback(
    async (input?: {
      body?: string;
      messageKind?: string;
      fileId?: string;
      ticketId?: string;
      quotedMessageId?: string;
    }) => {
      if (!activeConversation || !bootstrap) return;
      if (activeConversation.type === 'system') {
        setErrorMessage('Systemmeldungen sind schreibgeschützt.');
        return;
      }
      const rawBody = normalizeText(input?.body ?? draft);
      const messageKind = normalizeText(input?.messageKind) || 'text';
      const fileId = normalizeText(input?.fileId) || undefined;
      const ticketId = normalizeText(input?.ticketId) || undefined;
      const quotedMessageId = normalizeText(input?.quotedMessageId || quoteTarget?.id) || undefined;
      if (!rawBody && !fileId && !ticketId) return;

      const stanzaId = `stanza_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const optimisticId = `optimistic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const optimisticCreatedAt = new Date().toISOString();
      const optimisticMessage: ChatMessage = {
        id: optimisticId,
        senderAdminUserId: bootstrap.me.id,
        senderDisplayName: bootstrap.me.displayName,
        conversationId: activeConversation.id,
        messageKind,
        body: rawBody,
        file: null,
        ticketId: ticketId || null,
        xmppStanzaId:
          activeConversation.type === 'direct' || activeConversation.type === 'group' ? stanzaId : null,
        quote:
          quoteTarget && normalizeText(quoteTarget.id)
            ? {
                messageId: normalizeText(quoteTarget.id) || null,
                body: normalizeText(quoteTarget.body),
                senderDisplayName: normalizeText(quoteTarget.senderDisplayName),
              }
            : null,
        reactions: [],
        createdAt: optimisticCreatedAt,
        optimistic: true,
        readAtByMe: optimisticCreatedAt,
        deliveredByRecipientAt: null,
        readByRecipientAt: null,
        readByCount: 0,
      };
      appendMessages(activeConversation.id, [optimisticMessage]);
      setQuoteTarget(null);
      if (!input?.body) setDraft('');

      const xmpp = xmppRef.current;
      const shouldUseXmpp =
        (activeConversation.type === 'direct' || activeConversation.type === 'group') &&
        xmpp &&
        connectionState === 'online';
      if (shouldUseXmpp && messageKind !== 'call_event') {
        if (activeConversation.type === 'group') {
          await ensureRoomJoined(activeConversation.jid);
        }
        const to = activeConversation.jid;
        const type = activeConversation.type === 'group' ? 'groupchat' : 'chat';
        try {
          const messageChildren: any[] = [xml('body', {}, rawBody || 'Neue Nachricht')];
          if (activeConversation.type === 'direct') {
            messageChildren.push(xml('request', { xmlns: XMPP_NS_RECEIPTS }));
            messageChildren.push(xml('markable', { xmlns: XMPP_NS_CHAT_MARKERS }));
            messageChildren.push(xml('active', { xmlns: XMPP_NS_CHAT_STATES }));
          }
          await xmpp.send(xml('message', { to, type, id: stanzaId }, ...messageChildren));
          if (activeConversation.type === 'direct') {
            await sendTypingState(activeConversation, 'paused');
          }
        } catch {
          setErrorMessage('XMPP-Nachricht konnte nicht gesendet werden.');
        }
      }

      try {
        const response = await axios.post(
          '/api/admin/chat/messages',
          {
            conversationId: activeConversation.id,
            body: rawBody,
            messageKind,
            fileId,
            ticketId,
            xmppStanzaId:
              activeConversation.type === 'direct' || activeConversation.type === 'group'
                ? stanzaId
                : undefined,
            quotedMessageId,
          },
          { headers }
        );
        const responseItems = Array.isArray(response.data?.items) ? (response.data.items as ChatMessage[]) : [];
        const item = response.data?.item as ChatMessage | undefined;
        const assistantReply = response.data?.assistantReply as ChatMessage | undefined;
        if (responseItems.length > 0) {
          replaceOptimisticMessage(activeConversation.id, optimisticId, responseItems);
        } else if (item) {
          const replacementItems = assistantReply ? [item, assistantReply] : [item];
          replaceOptimisticMessage(activeConversation.id, optimisticId, replacementItems);
        } else if (assistantReply) {
          replaceOptimisticMessage(activeConversation.id, optimisticId, [optimisticMessage, assistantReply]);
        } else {
          replaceOptimisticMessage(activeConversation.id, optimisticId, []);
        }
        if (
          assistantReply &&
          responseItems.length > 0 &&
          !responseItems.find((entry) => normalizeText(entry?.id) === normalizeText(assistantReply.id))
        ) {
          appendMessages(activeConversation.id, [assistantReply]);
        }
        window.setTimeout(() => {
          void loadMessages(activeConversation.id, { silent: true });
        }, activeConversation.type === 'assistant' ? 300 : 1200);
      } catch (error: any) {
        replaceOptimisticMessage(activeConversation.id, optimisticId, []);
        setErrorMessage(error?.response?.data?.message || 'Nachricht konnte nicht gespeichert werden.');
      }
    },
    [
      activeConversation,
      appendMessages,
      bootstrap,
      connectionState,
      draft,
      ensureRoomJoined,
      headers,
      loadMessages,
      quoteTarget?.id,
      quoteTarget?.body,
      quoteTarget?.senderDisplayName,
      replaceOptimisticMessage,
      sendTypingState,
    ]
  );

  const handleUploadFile = async (file: File | null) => {
    if (!file || !activeConversation) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await axios.post('/api/admin/chat/upload', formData, {
        headers: {
          ...headers,
          'Content-Type': 'multipart/form-data',
        },
      });
      const uploaded = response.data?.item as ChatFile | undefined;
      if (!uploaded?.id) {
        setErrorMessage('Datei konnte nicht bereitgestellt werden.');
        return;
      }
      const fileMessageBody = `📎 ${uploaded.originalName}\n${uploaded.downloadUrl}`;
      await sendMessage({
        body: fileMessageBody,
        messageKind: 'file',
        fileId: uploaded.id,
      });
    } catch (error: any) {
      setErrorMessage(error?.response?.data?.message || 'Datei-Upload fehlgeschlagen.');
    }
  };

  const handleCreateCustomGroup = async () => {
    const name = normalizeText(newGroupName);
    if (!name) return;
    try {
      const response = await axios.post(
        '/api/admin/chat/groups/custom',
        {
          name,
          memberIds: newGroupMembers,
        },
        { headers }
      );
      const item = response.data?.item as ChatGroup | undefined;
      if (!item) return;
      setBootstrap((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          groups: {
            ...prev.groups,
            custom: [...(prev.groups?.custom || []), item],
          },
        };
      });
      setCreateGroupOpen(false);
      setNewGroupName('');
      setNewGroupMembers([]);
      setActiveConversationId(item.id);
    } catch (error: any) {
      setErrorMessage(error?.response?.data?.message || 'Gruppe konnte nicht erstellt werden.');
    }
  };

  const insertTicketLink = async () => {
    const ticketId = window.prompt('Ticket-ID eingeben:');
    const normalized = normalizeText(ticketId);
    if (!normalized) return;
    const url = `${window.location.origin}/admin/tickets/${encodeURIComponent(normalized)}`;
    await sendMessage({
      body: `🎫 Ticket ${normalized}\n${url}`,
      messageKind: 'ticket_link',
      ticketId: normalized,
    });
  };

  const handleEnableCallAudio = useCallback(async () => {
    appendCallDebugEntry('event', 'Audio-Unlock manuell ausgelöst');
    await refreshAudioOutputDevices();
    await resumeRemoteAudioPlayback();
  }, [appendCallDebugEntry, refreshAudioOutputDevices, resumeRemoteAudioPlayback]);

  const handleSelectAudioOutput = useCallback(
    (nextOutputId: string) => {
      const targetOutput = normalizeText(nextOutputId) || DEFAULT_AUDIO_OUTPUT_DEVICE_ID;
      setSelectedAudioOutputId(targetOutput);
      void applyAudioOutputDevice(targetOutput);
      if (!callSpeakerMuted) {
        void resumeRemoteAudioPlayback({ silenceError: true });
      }
    },
    [applyAudioOutputDevice, callSpeakerMuted, resumeRemoteAudioPlayback]
  );

  const canUseVideoCalls = useMemo(
    () => bootstrap?.calls?.media?.video !== false && bootstrap?.calls?.media?.upgradeSupported !== false,
    [bootstrap?.calls?.media?.upgradeSupported, bootstrap?.calls?.media?.video]
  );

  const upgradeCallToVideo = useCallback(async () => {
    const session = callSessionRef.current;
    if (!session) return;
    if (!canUseVideoCalls || !session.upgradeAllowed) {
      setErrorMessage('Videoanrufe sind in diesem Kontext deaktiviert.');
      return;
    }
    try {
      setCallStatusText('Video wird aktiviert…');
      setCallSession((current) =>
        current && current.callId === session.callId
          ? { ...current, requestedMediaType: 'video', mediaType: 'video', videoState: 'requesting' }
          : current
      );
      const stream = await ensureLocalAudioStream();
      const videoTrack = await ensureLocalVideoTrack();
      const pc = peerConnectionRef.current || createPeerConnectionForSession(session, stream);
      const videoSender = pc.getSenders().find((sender) => sender.track?.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(videoTrack);
      } else {
        pc.addTrack(videoTrack, stream);
      }
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      await sendWebRtcSignal(session.targetJid, session.callId, 'offer', { sdp: offer.sdp || '' });
      await updateCallMediaState(session.callId, {
        mediaType: 'video',
        requestedMediaType: 'video',
        upgradeState: 'audio_to_video',
      });
    } catch (error: any) {
      removeLocalVideoTracks();
      setCallSession((current) =>
        current && current.callId === session.callId
          ? { ...current, requestedMediaType: 'audio', mediaType: 'audio', videoState: 'failed' }
          : current
      );
      setCallStatusText('Video konnte nicht aktiviert werden');
      const message = normalizeText(error?.message) || 'Video konnte nicht aktiviert werden.';
      setErrorMessage(message);
    }
  }, [canUseVideoCalls, createPeerConnectionForSession, ensureLocalAudioStream, ensureLocalVideoTrack, removeLocalVideoTracks, sendWebRtcSignal, updateCallMediaState]);

  const downgradeCallToAudio = useCallback(async () => {
    const session = callSessionRef.current;
    if (!session) return;
    try {
      removeLocalVideoTracks();
      const pc = peerConnectionRef.current;
      if (pc) {
        const videoSenders = pc.getSenders().filter((sender) => sender.track?.kind === 'video');
        for (const sender of videoSenders) {
          await sender.replaceTrack(null);
        }
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false,
        });
        await pc.setLocalDescription(offer);
        await sendWebRtcSignal(session.targetJid, session.callId, 'offer', { sdp: offer.sdp || '' });
      }
      setCallSession((current) =>
        current && current.callId === session.callId
          ? { ...current, requestedMediaType: 'audio', mediaType: 'audio', videoState: 'off' }
          : current
      );
      setCallStatusText('Audioanruf aktiv');
      await updateCallMediaState(session.callId, {
        mediaType: 'audio',
        requestedMediaType: 'audio',
        upgradeState: 'video_to_audio',
      });
    } catch (error: any) {
      const message = normalizeText(error?.message);
      if (message) {
        setErrorMessage(message);
      }
    }
  }, [removeLocalVideoTracks, sendWebRtcSignal, updateCallMediaState]);

  const startVoiceCall = useCallback(async () => {
    if (!activeConversation || activeConversation.type !== 'direct') return;
    if (!callsEnabled) {
      setErrorMessage('Sprachanrufe sind in diesem Kontext deaktiviert.');
      return;
    }
    if (callSessionRef.current && callSessionRef.current.state !== 'ended' && callSessionRef.current.state !== 'failed') {
      setErrorMessage('Es läuft bereits ein aktiver Anruf.');
      return;
    }
    if (connectionState !== 'online') {
      setErrorMessage('Sprachanruf benötigt eine aktive XMPP-Verbindung.');
      return;
    }
    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session: ChatCallSession = {
      callId,
      conversationId: activeConversation.id,
      targetJid: activeConversation.jid,
      startedByMe: true,
      startedAt: Date.now(),
      state: 'outgoing',
      mediaType: 'audio',
      requestedMediaType: 'audio',
      videoState: 'off',
      clientConnectionId: chatClientId,
      upgradeAllowed: bootstrap?.calls?.media?.upgradeSupported !== false,
    };
    appendCallDebugEntry('event', `Ausgehender Call gestartet (${session.callId.slice(-6)})`);
    setCallMuted(false);
    setCallSpeakerMuted(false);
    setCallNeedsAudioUnlock(false);
    await refreshAudioOutputDevices();
    setCallSession(session);
    setIncomingCall(null);
    setCallStatusText(`Rufe ${activeConversation.label} an…`);
    try {
      await sendXmppCallMessage(
        activeConversation.jid,
        xml(
          'propose',
          { xmlns: XMPP_NS_JMI, id: callId },
          xml('description', { xmlns: 'urn:xmpp:jingle:apps:rtp:1', media: 'audio' })
        ),
        { strict: true }
      );
    } catch (error: any) {
      setCallSession({ ...session, state: 'failed' });
      setCallStatusText('Anruf konnte nicht gestartet werden');
      setErrorMessage(normalizeText(error?.message) || 'Anruf konnte nicht gestartet werden.');
    }
  }, [activeConversation, appendCallDebugEntry, bootstrap?.calls?.media?.upgradeSupported, callsEnabled, connectionState, refreshAudioOutputDevices, sendXmppCallMessage, chatClientId]);

  const acceptIncomingVoiceCall = useCallback(async () => {
    const pendingCall = incomingCallRef.current;
    if (!pendingCall) return;
    const direct = directConversations.find((entry) => entry.id === pendingCall.conversationId);
    if (!direct) return;
    if (!callsEnabled) {
      setErrorMessage('Sprachanrufe sind in diesem Kontext deaktiviert.');
      return;
    }

    try {
      const claimed = await claimIncomingCall(pendingCall);
      if (!claimed) {
        setIncomingCall(null);
        return;
      }
      setOpen(true);
      setActiveConversationId(pendingCall.conversationId);
      const stream = await ensureLocalAudioStream();
      const session: ChatCallSession = {
        callId: pendingCall.callId,
        conversationId: pendingCall.conversationId,
        targetJid: direct.jid,
        startedByMe: false,
        startedAt: Date.now(),
        state: 'connecting',
        mediaType: pendingCall.mediaType || 'audio',
        requestedMediaType: pendingCall.mediaType || 'audio',
        videoState: pendingCall.mediaType === 'video' ? 'requesting' : 'off',
        clientConnectionId: chatClientId,
        upgradeAllowed: bootstrap?.calls?.media?.upgradeSupported !== false,
      };
      appendCallDebugEntry('event', `Eingehender Call angenommen (${session.callId.slice(-6)})`);
      setCallMuted(false);
      setCallSpeakerMuted(false);
      setCallNeedsAudioUnlock(false);
      setCallSession(session);
      setIncomingCall(null);
      setCallStatusText(`Verbinde mit ${pendingCall.fromLabel}…`);
      createPeerConnectionForSession(session, stream);
      await sendXmppCallMessage(
        direct.jid,
        xml('accept', { xmlns: XMPP_NS_JMI, id: pendingCall.callId })
        ,
        { strict: true }
      );
    } catch (error: any) {
      setCallStatusText('Anruf konnte nicht angenommen werden');
      setErrorMessage(normalizeText(error?.message) || 'Anruf konnte nicht angenommen werden.');
      try {
        await sendXmppCallMessage(
          direct?.jid || pendingCall.fromJid,
          xml('reject', { xmlns: XMPP_NS_JMI, id: pendingCall.callId })
        );
      } catch {
        // ignore
      }
      cleanupCallMedia();
      setCallSession(null);
      setIncomingCall(null);
      void releaseCallClaim(pendingCall.callId, 'failed', { mediaTypeFinal: 'audio', endedReason: 'accept_failed' });
    }
  }, [
    appendCallDebugEntry,
    claimIncomingCall,
    createPeerConnectionForSession,
    directConversations,
    ensureLocalAudioStream,
    sendXmppCallMessage,
    callsEnabled,
    bootstrap?.calls?.media?.upgradeSupported,
    chatClientId,
    releaseCallClaim,
  ]);

  const rejectIncomingVoiceCall = useCallback(async () => {
    const pendingCall = incomingCallRef.current;
    if (!pendingCall) return;
    const direct = directConversations.find((entry) => entry.id === pendingCall.conversationId);
    try {
      await sendXmppCallMessage(
        direct?.jid || pendingCall.fromJid,
        xml('reject', { xmlns: XMPP_NS_JMI, id: pendingCall.callId })
      );
    } catch {
      // ignore
    }
    setIncomingCall(null);
    setCallStatusText('Anruf abgelehnt');
    appendCallDebugEntry('event', `Eingehender Call abgelehnt (${pendingCall.callId.slice(-6)})`);
    void releaseCallClaim(pendingCall.callId, 'rejected', { mediaTypeFinal: 'audio', endedReason: 'rejected_by_local_user' });
  }, [appendCallDebugEntry, directConversations, sendXmppCallMessage, releaseCallClaim]);

  const toggleBrowserNotifications = async () => {
    const next = !browserNotifyEnabled;
    setBrowserNotifyEnabled(next);
    if (next && browserPermission !== 'granted') {
      await requestBrowserNotificationPermission();
    }
  };

  const applyPresenceExpiryMinutes = (minutes: number | null) => {
    setPresenceDraft((current) => ({
      ...current,
      expiresAt: minutes && minutes > 0 ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null,
    }));
  };

  const openStatusQuickMenu = (event: React.MouseEvent<HTMLElement>) => {
    setStatusMenuAnchorEl(event.currentTarget);
  };

  const closeStatusQuickMenu = () => {
    setStatusMenuAnchorEl(null);
  };

  const applyQuickStatus = async (status: Exclude<ChatSelfStatusKey, 'custom'>, expiresInMinutes?: number | null) => {
    const preset = SELF_STATUS_PRESETS[status];
    const nextPresence: ChatSelfPresenceSettings = {
      status,
      label: '',
      color: preset.color,
      emoji: preset.emoji,
      expiresAt: expiresInMinutes && expiresInMinutes > 0 ? new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString() : null,
    };
    closeStatusQuickMenu();
    await savePresenceSettings(nextPresence);
  };

  const openPresenceDialog = () => {
    setPresenceDraft(selfPresence);
    setStatusMenuAnchorEl(null);
    setPresenceDialogOpen(true);
  };

  const closePresenceDialog = () => {
    if (presenceSaving) return;
    setPresenceDialogOpen(false);
    setPresenceDraft(selfPresence);
  };

  const detachChatWindow = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('chatWindow', '1');
    if (activeConversationId) {
      url.searchParams.set('chat', activeConversationId);
    }
    const popup = window.open(
      url.toString(),
      'behebes_admin_chat',
      'popup=yes,width=1360,height=920,left=120,top=90,resizable=yes,scrollbars=yes'
    );
    if (popup) {
      popup.focus();
    }
  };

  const handleDragStart = (event: React.MouseEvent) => {
    if (chatDisplayMode !== 'floating' || isNarrowScreen) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-chat-drag-ignore="1"]')) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: floatingPosition.x,
      baseY: floatingPosition.y,
    };
    const onMove = (moveEvent: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = moveEvent.clientX - drag.startX;
      const dy = moveEvent.clientY - drag.startY;
      const nextX = Math.max(8, Math.min(window.innerWidth - 360, drag.baseX + dx));
      const nextY = Math.max(8, Math.min(window.innerHeight - 220, drag.baseY + dy));
      setFloatingPosition({ x: nextX, y: nextY });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    event.preventDefault();
  };

  const renderShell = () => {
    const typingLabel = typingByConversation[activeConversationId] || '';
    const conversationListBase = tabMode === 'direct' ? directConversations : groupConversations;
    const searchTerm = normalizeText(conversationSearch).toLowerCase();
    const conversationList = !searchTerm
      ? conversationListBase
      : conversationListBase.filter((entry) => {
          const label = normalizeText(entry.label).toLowerCase();
          const subtitle = normalizeText(entry.subtitle).toLowerCase();
          return label.includes(searchTerm) || subtitle.includes(searchTerm);
        });
    const selfStatusLabel = resolveSelfStatusDisplayLabel(selfPresence);
    const selfStatusColor = resolveSelfStatusColor(selfPresence);
    const selfStatusExpiryLabel = formatPresenceExpiryLabel(selfPresence.expiresAt);
    const showDirectHierarchy = tabMode === 'direct' && directViewMode === 'hierarchy' && !searchTerm;
    const resolvePresenceForContact = (contactId?: string): PresenceState =>
      contactId ? presenceByUserId[contactId] || 'offline' : 'online';
    const activeMessageSearchTerm = normalizeText(messageSearch).toLowerCase();
    const visibleMessages = !activeMessageSearchTerm
      ? activeMessages
      : activeMessages.filter((entry) => {
          const body = normalizeText(entry.body).toLowerCase();
          const sender = normalizeText(entry.senderDisplayName).toLowerCase();
          return body.includes(activeMessageSearchTerm) || sender.includes(activeMessageSearchTerm);
        });
    const conversationReadOnly = activeConversation?.type === 'system';

    const renderConversationRow = (
      entry: ConversationEntry,
      options?: {
        key?: string;
        compact?: boolean;
        subtitleOverride?: React.ReactNode;
        prepend?: React.ReactNode;
        showDeleteAction?: boolean;
        marginLeft?: number;
      }
    ) => {
      const presence = resolvePresenceForContact(entry.contactId);
      const isCustomGroup = entry.id.startsWith('custom:');
      const customGroup = isCustomGroup ? customGroupByConversationId.get(entry.id) : null;
      const secondaryNode =
        options?.subtitleOverride !== undefined
          ? options.subtitleOverride
          : entry.type === 'direct'
          ? (
            <Stack direction="row" spacing={0.8} alignItems="center">
              <FiberManualRecordIcon sx={{ fontSize: 10, color: getPresenceColor(presence) }} />
              <span>{resolvePresenceStateLabel(presence)}</span>
            </Stack>
          )
          : (
            entry.subtitle
          );

      return (
        <ListItemButton
          key={options?.key || entry.id}
          selected={activeConversationId === entry.id}
          onClick={() => handleSelectConversation(entry.id)}
          sx={{
            borderRadius: 1.5,
            mx: 0.8,
            mb: 0.4,
            ml: options?.marginLeft !== undefined ? `${options.marginLeft}px` : undefined,
            '&.Mui-selected': {
              bgcolor: '#dbeafe',
              border: '1px solid #93c5fd',
            },
          }}
        >
          {options?.prepend}
          {entry.type === 'direct' ? (
            <Badge
              overlap="circular"
              variant="dot"
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              sx={{
                mr: 1,
                '& .MuiBadge-badge': {
                  bgcolor: getPresenceColor(presence),
                  width: 10,
                  height: 10,
                  minWidth: 10,
                  border: '2px solid #f8fafc',
                },
              }}
            >
              <Avatar sx={{ width: options?.compact ? 26 : 30, height: options?.compact ? 26 : 30, fontSize: 12 }}>
                {initialsFromName(entry.label)}
              </Avatar>
            </Badge>
          ) : entry.type === 'assistant' ? (
            <Avatar sx={{ width: 30, height: 30, fontSize: 16, mr: 1, bgcolor: '#dbeafe', color: '#1d4ed8' }}>
              {'AI'}
            </Avatar>
          ) : entry.type === 'system' ? (
            <Avatar sx={{ width: 30, height: 30, fontSize: 16, mr: 1, bgcolor: '#dcfce7', color: '#166534' }}>
              <SettingsSuggestIcon sx={{ fontSize: 17 }} />
            </Avatar>
          ) : (
            <Avatar sx={{ width: 30, height: 30, fontSize: 12, mr: 1 }}>
              {initialsFromName(entry.label)}
            </Avatar>
          )}
          <ListItemText
            primary={entry.label}
            secondary={secondaryNode}
            primaryTypographyProps={{ noWrap: true, fontWeight: 600, sx: { fontSize: options?.compact ? 13 : undefined } }}
            secondaryTypographyProps={{ noWrap: true, sx: { fontSize: 12 } }}
          />
          <Stack direction="row" spacing={0.5} alignItems="center">
            {(options?.showDeleteAction !== false && customGroup?.canManageDelete) ? (
              <Tooltip title="Gruppe löschen">
                <IconButton
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDeleteCustomGroup(customGroup);
                  }}
                  sx={{ color: '#b91c1c' }}
                >
                  <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            ) : null}
            {unreadCounts[entry.id] ? <Chip size="small" color="error" label={unreadCounts[entry.id]} /> : null}
          </Stack>
        </ListItemButton>
      );
    };

    const renderDirectHierarchyNode = (
      orgUnitId: string,
      depth: number,
      trail: Set<string>
    ): React.ReactNode => {
      if (trail.has(orgUnitId)) return null;
      const nextTrail = new Set(trail);
      nextTrail.add(orgUnitId);
      const orgUnit = directoryOrgUnitById.get(orgUnitId);
      if (!orgUnit) return null;
      const scopedUsers = directoryScopesByOrgUnitId.get(orgUnitId) || [];
      const children = directoryChildrenByParentId.get(orgUnitId) || [];
      const leftIndent = Math.max(0, depth * 14);
      return (
        <Box key={`org-node-${orgUnitId}`} sx={{ pb: 0.2 }}>
          <Box
            sx={{
              ml: `${leftIndent + 10}px`,
              mr: 1,
              mb: 0.4,
              px: 1,
              py: 0.55,
              borderRadius: 1.2,
              bgcolor: '#eaf2ff',
              border: '1px solid #c7dcfb',
            }}
          >
            <Typography variant="caption" sx={{ display: 'block', fontWeight: 800, color: '#0f355f' }}>
              {orgUnit.name}
            </Typography>
            <Typography variant="caption" sx={{ color: '#436182', fontSize: 11 }}>
              {orgUnit.tenantName || orgUnit.tenantId || 'Mandant'}
            </Typography>
          </Box>
          {scopedUsers.map((scopeEntry, idx) => {
            const conversation = directConversationByContactId.get(scopeEntry.contactId);
            if (!conversation) return null;
            const roleHint = scopeEntry.canWrite ? 'Schreibzugriff' : 'Lesezugriff';
            const presence = resolvePresenceForContact(scopeEntry.contactId);
            const subtitle = (
              <Stack direction="row" spacing={0.75} alignItems="center">
                <FiberManualRecordIcon
                  sx={{
                    fontSize: 10,
                    color: getPresenceColor(presence),
                  }}
                />
                <span>{resolvePresenceStateLabel(presence)}</span>
                <span>· {roleHint}</span>
              </Stack>
            );
            return renderConversationRow(conversation, {
              key: `org-scope-${orgUnitId}-${scopeEntry.contactId}-${idx}`,
              compact: true,
              subtitleOverride: subtitle,
              marginLeft: leftIndent + 18,
            });
          })}
          {children.map((child) => renderDirectHierarchyNode(child.id, depth + 1, nextTrail))}
        </Box>
      );
    };

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box
          onMouseDown={handleDragStart}
          sx={{
            px: 2,
            py: 1.2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(120deg, #0b1d3a 0%, #0b4ea2 55%, #0f8a9d 100%)',
            color: 'white',
            cursor: chatDisplayMode === 'floating' && !isNarrowScreen ? 'move' : 'default',
            boxShadow: '0 8px 18px rgba(2, 6, 23, 0.25)',
          }}
        >
          <Stack direction="row" spacing={1.4} alignItems="center">
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Teamchat</Typography>
            <Chip size="small" color={STATUS_COLORS[connectionHealthState]} label={STATUS_LABELS[connectionHealthState]} />
            {xmppLatencyMs !== null ? (
              <Chip
                size="small"
                icon={<PhoneInTalkIcon sx={{ color: '#dbeafe !important' }} />}
                label={`${xmppLatencyMs} ms`}
                sx={{
                  bgcolor: 'rgba(15, 23, 42, 0.3)',
                  color: '#dbeafe',
                  border: '1px solid rgba(147, 197, 253, 0.45)',
                }}
              />
            ) : null}
            {callSession ? (
              <Chip
                size="small"
                icon={<CallIcon sx={{ color: '#dcfce7 !important' }} />}
                label={callStatusText || 'Anruf aktiv'}
                sx={{
                  bgcolor: 'rgba(22, 163, 74, 0.22)',
                  color: '#dcfce7',
                  border: '1px solid rgba(134, 239, 172, 0.5)',
                }}
              />
            ) : null}
            {rtcBestEffortOnly ? (
              <Tooltip
                title={
                  <Box sx={{ maxWidth: 320 }}>
                    <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>
                      Best-Effort-Sprachanruf
                    </Typography>
                    {(rtcReliabilityHints.length > 0 ? rtcReliabilityHints : ['TURN ist derzeit nicht vollständig verfügbar.']).map(
                      (hint, index) => (
                        <Typography key={`rtc-hint-${index}`} variant="caption" sx={{ display: 'block', lineHeight: 1.35 }}>
                          {`• ${hint}`}
                        </Typography>
                      )
                    )}
                  </Box>
                }
              >
                <Chip
                  size="small"
                  label="Best-Effort"
                  sx={{
                    bgcolor: 'rgba(245, 158, 11, 0.24)',
                    color: '#fef3c7',
                    border: '1px solid rgba(251, 191, 36, 0.55)',
                    '& .MuiChip-label': { fontWeight: 700 },
                  }}
                />
              </Tooltip>
            ) : null}
            <Tooltip title="Status schnell ändern">
              <Chip
                size="small"
                label={selfStatusLabel}
                onClick={openStatusQuickMenu}
                sx={{
                  bgcolor: 'rgba(255,255,255,0.18)',
                  color: '#ffffff',
                  border: '1px solid rgba(255,255,255,0.32)',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)',
                  '& .MuiChip-label': { fontWeight: 700 },
                  '& .MuiChip-avatar': {
                    bgcolor: 'transparent',
                  },
                  '&::before': {
                    content: '""',
                    display: 'inline-block',
                    width: 9,
                    height: 9,
                    borderRadius: '999px',
                    backgroundColor: selfStatusColor,
                    marginLeft: 10,
                    boxShadow: '0 0 0 2px rgba(15,23,42,0.2)',
                  },
                }}
              />
            </Tooltip>
            {selfStatusExpiryLabel ? (
              <Chip
                size="small"
                icon={<AccessTimeIcon sx={{ color: '#dbeafe !important' }} />}
                label={selfStatusExpiryLabel}
                sx={{
                  bgcolor: 'rgba(15, 23, 42, 0.3)',
                  color: '#dbeafe',
                  border: '1px solid rgba(147, 197, 253, 0.45)',
                }}
              />
            ) : null}
          </Stack>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title={conversationListOpen ? 'Kontakt-/Gruppenliste ausblenden' : 'Kontakt-/Gruppenliste einblenden'}>
              <IconButton
                data-chat-drag-ignore="1"
                onClick={() => setConversationListOpen((prev) => !prev)}
                sx={{ color: 'white' }}
              >
                <ViewListIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={browserNotifyEnabled ? 'Browser-Benachrichtigungen ausschalten' : 'Browser-Benachrichtigungen einschalten'}>
              <IconButton data-chat-drag-ignore="1" onClick={() => void toggleBrowserNotifications()} sx={{ color: 'white' }}>
                {browserNotifyEnabled ? <NotificationsActiveIcon /> : <NotificationsOffIcon />}
              </IconButton>
            </Tooltip>
            {!embedded ? (
              <Tooltip title={chatDisplayMode === 'drawer' ? 'Als Floating-Fenster' : 'Als Sidebar andocken'}>
                <IconButton
                  data-chat-drag-ignore="1"
                  onClick={() => setChatDisplayMode((prev) => (prev === 'drawer' ? 'floating' : 'drawer'))}
                  sx={{ color: 'white' }}
                >
                  {chatDisplayMode === 'drawer' ? <FilterNoneIcon /> : <ViewSidebarIcon />}
                </IconButton>
              </Tooltip>
            ) : null}
            {!embedded ? (
              <Tooltip title="In separates Fenster abkoppeln">
                <IconButton data-chat-drag-ignore="1" onClick={detachChatWindow} sx={{ color: 'white' }}>
                  <OpenInNewIcon />
                </IconButton>
              </Tooltip>
            ) : null}
            {!detachedView && !embedded ? (
              <Tooltip title="Chat schließen">
                <IconButton data-chat-drag-ignore="1" onClick={() => setOpen(false)} sx={{ color: 'white' }}>
                  <CloseIcon />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title="Chat-Daten neu laden">
              <IconButton data-chat-drag-ignore="1" onClick={() => void loadBootstrap()} disabled={loadingBootstrap} sx={{ color: 'white' }}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        <Box sx={{ display: 'flex', flex: 1, minHeight: 0, bgcolor: '#eff6ff' }}>
          {conversationListOpen ? (
            <Box
              sx={{
                width: { xs: 300, sm: 340 },
                borderRight: '1px solid',
                borderColor: '#cbd5e1',
                display: 'flex',
                flexDirection: 'column',
                bgcolor: '#f8fafc',
              }}
            >
              <Tabs
                value={tabMode}
                onChange={(_event, value: TabMode) => setTabMode(value)}
                variant="fullWidth"
                sx={{ borderBottom: '1px solid #cbd5e1' }}
              >
                <Tab value="direct" label="Direkt" />
                <Tab value="group" label="Gruppen" />
              </Tabs>

              <Box sx={{ px: 1.3, pt: 1, pb: 0.8 }}>
                <TextField
                  size="small"
                  value={conversationSearch}
                  onChange={(event) => setConversationSearch(event.target.value)}
                  placeholder={tabMode === 'direct' ? 'Person suchen…' : 'Gruppe suchen…'}
                  fullWidth
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ fontSize: 18, color: '#64748b', mr: 0.8 }} />,
                  }}
                  sx={{
                    mb: 0.9,
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 1.8,
                      bgcolor: '#ffffff',
                    },
                  }}
                />
                <Stack direction="row" spacing={0.7} alignItems="center" justifyContent="space-between">
                  <Typography variant="caption" color="text.secondary">
                    {tabMode === 'direct' ? 'Direktnachrichten' : 'Gruppenchats'}
                  </Typography>
                  <Stack direction="row" spacing={0.6} alignItems="center">
                  {tabMode === 'direct' ? (
                    <>
                      <Button
                        size="small"
                        variant={directViewMode === 'list' ? 'contained' : 'outlined'}
                        onClick={() => setDirectViewMode('list')}
                      >
                        Liste
                      </Button>
                      <Button
                        size="small"
                        variant={directViewMode === 'hierarchy' ? 'contained' : 'outlined'}
                        onClick={() => setDirectViewMode('hierarchy')}
                      >
                        Hierarchie
                      </Button>
                    </>
                  ) : null}
                  {tabMode === 'group' ? (
                    <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateGroupOpen(true)}>
                      Gruppe
                    </Button>
                  ) : null}
                  </Stack>
                </Stack>
              </Box>

              <List sx={{ overflowY: 'auto', flex: 1, pt: 0 }}>
                {showDirectHierarchy ? (
                  <>
                    {assistantConversation
                      ? renderConversationRow(assistantConversation, {
                          key: 'direct-assistant-hierarchy',
                        })
                      : null}
                    {systemConversation
                      ? renderConversationRow(systemConversation, {
                          key: 'direct-system-hierarchy',
                        })
                      : null}
                    {(directoryChildrenByParentId.get(CHAT_DIRECTORY_ROOT_KEY) || []).map((rootNode) =>
                      renderDirectHierarchyNode(rootNode.id, 0, new Set<string>())
                    )}
                    {directConversationsWithoutScopes.length > 0 ? (
                      <Box sx={{ px: 1, pb: 0.5 }}>
                        <Box
                          sx={{
                            mx: 0.3,
                            mb: 0.4,
                            px: 1,
                            py: 0.55,
                            borderRadius: 1.2,
                            bgcolor: '#eef2f7',
                            border: '1px solid #d5dee9',
                          }}
                        >
                          <Typography variant="caption" sx={{ display: 'block', fontWeight: 800, color: '#243447' }}>
                            Ohne Scope-Zuordnung
                          </Typography>
                        </Box>
                        {directConversationsWithoutScopes.map((entry) =>
                          renderConversationRow(entry, {
                            key: `direct-unscoped-${entry.id}`,
                            compact: true,
                            marginLeft: 8,
                          })
                        )}
                      </Box>
                    ) : null}
                    {directoryOrgUnits.length === 0 && directHumanConversations.length > 0 ? (
                      directHumanConversations.map((entry) =>
                        renderConversationRow(entry, {
                          key: `direct-flat-fallback-${entry.id}`,
                        })
                      )
                    ) : null}
                  </>
                ) : (
                  conversationList.length > 0 ? (
                    conversationList.map((entry) =>
                      renderConversationRow(entry, {
                        key: `conversation-${entry.id}`,
                      })
                    )
                  ) : (
                    <Box sx={{ px: 2, py: 1.2 }}>
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Keine Unterhaltung für den aktuellen Filter.
                      </Typography>
                    </Box>
                  )
                )}
              </List>
            </Box>
          ) : null}

          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {activeConversation ? (
              <>
                <Box sx={{ px: 2, py: 1.3, borderBottom: '1px solid', borderColor: '#cbd5e1', bgcolor: '#f8fafc' }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} justifyContent="space-between">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
                        {activeConversation.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {activeConversation.type === 'direct'
                          ? `${activeConversation.subtitle} · ${resolvePresenceStateLabel(
                              presenceByUserId[activeConversation.contactId || ''] || 'offline'
                            )}`
                          : activeConversation.subtitle}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: { xs: '100%', md: 'auto' } }}>
                      {(activeConversation.type === 'direct') ? (
                        <>
                          {callSession ? (
                            <>
                              <Tooltip title={callMuted ? 'Mikrofon einschalten' : 'Mikrofon stummschalten'}>
                                <IconButton
                                  size="small"
                                  onClick={() => setCallMuted((prev) => !prev)}
                                  sx={actionButtonSx}
                                >
                                  {callMuted ? <MicOffIcon /> : <MicIcon />}
                                </IconButton>
                              </Tooltip>
                              <Tooltip title={callSpeakerMuted ? 'Audioausgabe einschalten' : 'Audioausgabe stummschalten'}>
                                <IconButton
                                  size="small"
                                  onClick={() => setCallSpeakerMuted((prev) => !prev)}
                                  sx={actionButtonSx}
                                >
                                  {callSpeakerMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
                                </IconButton>
                              </Tooltip>
                              {canSelectAudioOutput ? (
                                <Tooltip title="Audioausgabe wählen">
                                  <Select
                                    size="small"
                                    value={selectedAudioOutputId}
                                    onChange={(event) => handleSelectAudioOutput(String(event.target.value))}
                                    sx={{
                                      minWidth: { xs: 132, md: 184 },
                                      height: 34,
                                      bgcolor: '#ffffff',
                                      borderRadius: 1.4,
                                      '& .MuiSelect-select': {
                                        py: 0.7,
                                        px: 1.1,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        color: '#0f172a',
                                      },
                                    }}
                                  >
                                    {availableAudioOutputOptions.map((entry) => (
                                      <MenuItem key={`call-output-${entry.id}`} value={entry.id}>
                                        {entry.label}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </Tooltip>
                              ) : null}
                              {callNeedsAudioUnlock && !callSpeakerMuted ? (
                                <Tooltip title="Audioausgabe aktivieren">
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => void handleEnableCallAudio()}
                                    startIcon={<VolumeUpIcon sx={{ fontSize: 16 }} />}
                                    sx={{
                                      textTransform: 'none',
                                      fontWeight: 700,
                                      borderColor: '#60a5fa',
                                      color: '#1d4ed8',
                                      bgcolor: '#eff6ff',
                                      '&:hover': {
                                        borderColor: '#3b82f6',
                                        bgcolor: '#dbeafe',
                                      },
                                    }}
                                  >
                                    Audio aktivieren
                                  </Button>
                                </Tooltip>
                              ) : null}
                              <Tooltip title="Anruf beenden">
                                <IconButton
                                  size="small"
                                  onClick={() => void endCurrentCall('finish', true)}
                                  sx={{
                                    ...actionButtonSx,
                                    bgcolor: '#dc2626',
                                    borderColor: '#b91c1c',
                                    color: '#ffffff',
                                    '&:hover': {
                                      bgcolor: '#b91c1c',
                                      color: '#ffffff',
                                      borderColor: '#991b1b',
                                    },
                                  }}
                                >
                                  <CallEndIcon />
                                </IconButton>
                              </Tooltip>
                            </>
                          ) : (
                            <Tooltip title={callsEnabled ? 'Sprachanruf starten' : 'Sprachanrufe sind deaktiviert'}>
                              <IconButton
                                size="small"
                                onClick={() => void startVoiceCall()}
                                disabled={!callsEnabled}
                                sx={{
                                  ...actionButtonSx,
                                  bgcolor: '#16a34a',
                                  borderColor: '#15803d',
                                  color: '#ffffff',
                                  '&:hover': {
                                    bgcolor: '#15803d',
                                    borderColor: '#166534',
                                    color: '#ffffff',
                                  },
                                }}
                              >
                                <CallIcon />
                              </IconButton>
                            </Tooltip>
                          )}
                        </>
                      ) : null}
                      <Tooltip title="XMPP-Verlauf synchronisieren">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => void syncXmppArchiveForConversation(activeConversation, 120)}
                            disabled={
                              syncingXmppHistory ||
                              connectionState !== 'online' ||
                              (activeConversation.type !== 'direct' && activeConversation.type !== 'group')
                            }
                            sx={actionButtonSx}
                          >
                            <HistoryIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <TextField
                        size="small"
                        value={messageSearch}
                        onChange={(event) => setMessageSearch(event.target.value)}
                        placeholder="Nachrichten filtern…"
                        sx={{
                          minWidth: { xs: '100%', md: 250 },
                          '& .MuiOutlinedInput-root': { borderRadius: 1.7, bgcolor: '#ffffff' },
                        }}
                        InputProps={{
                          startAdornment: <SearchIcon sx={{ fontSize: 18, color: '#64748b', mr: 0.7 }} />,
                        }}
                      />
                    </Stack>
                  </Stack>
                  {!conversationListOpen ? (
                    <Box sx={{ mt: 1 }}>
                      <Select
                        value={activeConversationId}
                        onChange={(event) => handleSelectConversation(String(event.target.value))}
                        size="small"
                        fullWidth
                      >
                        {allConversations.map((entry) => (
                          <MenuItem key={entry.id} value={entry.id}>
                            {entry.type === 'direct'
                              ? `Direkt · ${entry.label}`
                              : entry.type === 'group'
                              ? `Gruppe · ${entry.label}`
                              : entry.type === 'assistant'
                              ? `KI · ${entry.label}`
                              : `System · ${entry.label}`}
                          </MenuItem>
                        ))}
                      </Select>
                    </Box>
                  ) : null}
                </Box>

                <Box
                  ref={messageListRef}
                  onScroll={handleMessageListScroll}
                  sx={{
                    flex: 1,
                    overflowY: 'auto',
                    px: 2,
                    py: 2,
                    background: 'linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%)',
                  }}
                >
                  {loadingMessages ? (
                    <Typography variant="body2" color="text.secondary">
                      Lade Nachrichten…
                    </Typography>
                  ) : visibleMessages.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {activeMessageSearchTerm
                        ? 'Keine Nachrichten für den aktuellen Filter gefunden.'
                        : 'Noch keine Nachrichten in dieser Unterhaltung.'}
                    </Typography>
                  ) : (
                    <Stack spacing={1.25}>
                      {visibleMessages.map((message) => {
                        const mine = message.senderAdminUserId === bootstrap?.me.id;
                        const isCallEvent = normalizeText(message.messageKind).toLowerCase() === 'call_event';
                        const readHint =
                          mine && activeConversation.type === 'direct'
                            ? message.readByRecipientAt
                              ? `Gelesen ${formatTime(message.readByRecipientAt)}`
                              : message.deliveredByRecipientAt
                                ? `Zugestellt ${formatTime(message.deliveredByRecipientAt)}`
                              : 'Gesendet'
                            : mine && Number(message.readByCount || 0) > 0
                            ? `Gelesen von ${Number(message.readByCount || 0)}`
                            : '';
                        return (
                          <Stack
                            key={`${message.id}-${message.createdAt || ''}`}
                            direction="row"
                            spacing={1}
                            justifyContent={mine ? 'flex-end' : 'flex-start'}
                          >
                            {!mine ? (
                              <Avatar sx={{ width: 28, height: 28, fontSize: 12, mt: 0.2 }}>
                                {initialsFromName(message.senderDisplayName)}
                              </Avatar>
                            ) : null}
                            <Box
                              sx={{
                                maxWidth: '76%',
                                px: 1.35,
                                py: 1,
                                borderRadius: 2,
                                bgcolor: isCallEvent ? (mine ? '#0f766e' : '#ecfeff') : mine ? '#1d4ed8' : '#ffffff',
                                color: isCallEvent ? (mine ? '#ecfeff' : '#0f172a') : mine ? 'white' : '#0f172a',
                                border: isCallEvent
                                  ? `1px solid ${mine ? '#0f766e' : '#99f6e4'}`
                                  : mine
                                  ? '1px solid #1e40af'
                                  : '1px solid #dbe4f0',
                                boxShadow: isCallEvent
                                  ? '0 4px 12px rgba(20,184,166,.18)'
                                  : mine
                                  ? '0 8px 18px rgba(37,99,235,.25)'
                                  : '0 6px 16px rgba(15,23,42,.08)',
                              }}
                            >
                              {!mine ? (
                                <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.4 }}>
                                  {renderHighlightedText(message.senderDisplayName, messageSearch)}
                                </Typography>
                              ) : null}
                              {message.quote?.body && !isCallEvent ? (
                                <Box
                                  sx={{
                                    mb: 0.8,
                                    px: 1,
                                    py: 0.7,
                                    borderRadius: 1.3,
                                    bgcolor: mine ? 'rgba(255,255,255,.18)' : '#f0f7ff',
                                    border: mine ? '1px solid rgba(255,255,255,.26)' : '1px solid #d6e6fa',
                                  }}
                                >
                                  <Typography variant="caption" sx={{ fontWeight: 700, opacity: mine ? 0.9 : 0.75 }}>
                                    {message.quote.senderDisplayName || 'Zitat'}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    sx={{ display: 'block', mt: 0.2, whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: mine ? 0.92 : 0.78 }}
                                  >
                                    {message.quote.body}
                                  </Typography>
                                </Box>
                              ) : null}
                              {isCallEvent ? (
                                <Stack direction="row" spacing={0.8} alignItems="flex-start">
                                  <PhoneInTalkIcon sx={{ fontSize: 16, mt: 0.15, opacity: mine ? 0.92 : 0.78 }} />
                                  <Typography
                                    variant="body2"
                                    sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.42, fontWeight: 600 }}
                                  >
                                    {renderHighlightedText(message.body, messageSearch)}
                                  </Typography>
                                </Stack>
                              ) : (
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.42 }}>
                                  {renderHighlightedText(message.body, messageSearch)}
                                </Typography>
                              )}
                              {message.file?.downloadUrl && !isCallEvent ? (
                                <Typography variant="caption" sx={{ display: 'block', mt: 0.7 }}>
                                  <a href={message.file.downloadUrl} target="_blank" rel="noreferrer" style={{ color: mine ? '#dbeafe' : '#1d4ed8' }}>
                                    Datei öffnen: {message.file.originalName}
                                  </a>
                                </Typography>
                              ) : null}
                              <Stack direction="row" spacing={0.6} alignItems="center" justifyContent={mine ? 'flex-end' : 'flex-start'} sx={{ mt: 0.4 }}>
                                <Typography variant="caption" sx={{ opacity: mine ? 0.88 : 0.72 }}>
                                  {formatTime(message.createdAt)}
                                </Typography>
                                {mine && activeConversation.type === 'direct' ? (
                                  message.readByRecipientAt ? (
                                    <DoneAllIcon sx={{ fontSize: 13, opacity: 0.9 }} />
                                  ) : message.deliveredByRecipientAt ? (
                                    <DoneIcon sx={{ fontSize: 13, opacity: 0.82 }} />
                                  ) : (
                                    <AccessTimeIcon sx={{ fontSize: 13, opacity: 0.75 }} />
                                  )
                                ) : null}
                                {readHint ? (
                                  <Typography variant="caption" sx={{ opacity: mine ? 0.88 : 0.66 }}>
                                    {readHint}
                                  </Typography>
                                ) : null}
                                {!conversationReadOnly && !isCallEvent ? (
                                  <>
                                    <Tooltip title="Nachricht zitieren">
                                      <IconButton
                                        size="small"
                                        onClick={() => setQuoteTarget(message)}
                                        sx={{ color: mine ? '#dbeafe' : '#1d4ed8', p: 0.3, ml: 0.3 }}
                                      >
                                        <FormatQuoteIcon sx={{ fontSize: 14 }} />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Reaktion hinzufügen">
                                      <IconButton
                                        size="small"
                                        onClick={(event) => openReactionMenu(event, message.id)}
                                        sx={{ color: mine ? '#dbeafe' : '#1d4ed8', p: 0.3 }}
                                      >
                                        <AddReactionIcon sx={{ fontSize: 14 }} />
                                      </IconButton>
                                    </Tooltip>
                                  </>
                                ) : null}
                              </Stack>
                              {(message.reactions || []).length > 0 && !isCallEvent ? (
                                <Stack direction="row" spacing={0.55} sx={{ mt: 0.65, flexWrap: 'wrap' }}>
                                  {(message.reactions || []).map((reaction) => (
                                    <Tooltip key={`${message.id}-${reaction.emoji}`} title={(reaction.reactors || []).join(', ') || 'Reaktion'}>
                                      <Chip
                                        size="small"
                                        label={`${reaction.emoji}${reaction.count > 1 ? ` ${reaction.count}` : ''}`}
                                        color={reaction.reactedByMe ? 'primary' : 'default'}
                                        variant={reaction.reactedByMe ? 'filled' : 'outlined'}
                                        onClick={conversationReadOnly ? undefined : () => void toggleReaction(message, reaction.emoji)}
                                        sx={{ height: 22, fontWeight: 600 }}
                                      />
                                    </Tooltip>
                                  ))}
                                </Stack>
                              ) : null}
                            </Box>
                          </Stack>
                        );
                      })}
                    </Stack>
                  )}
                </Box>

                {showScrollToBottom ? (
                  <Box sx={{ px: 2, py: 0.6, bgcolor: '#f8fbff', borderTop: '1px solid #d8e3f3' }}>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<ArrowDownwardIcon sx={{ fontSize: 15 }} />}
                      onClick={() => {
                        const container = messageListRef.current;
                        if (!container) return;
                        container.scrollTop = container.scrollHeight;
                        shouldStickToBottomRef.current = true;
                        setShowScrollToBottom(false);
                      }}
                      sx={{ borderRadius: 999 }}
                    >
                      Neue Nachrichten
                    </Button>
                  </Box>
                ) : null}

                <Divider />
                <Box sx={{ px: 2, py: 1.2, bgcolor: '#f8fafc' }}>
                  {typingLabel && !conversationReadOnly ? (
                    <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mb: 0.7 }}>
                      <Typography variant="caption" sx={{ color: '#334155' }}>
                        {typingLabel} tippt
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#64748b', letterSpacing: 1.1 }}>
                        ...
                      </Typography>
                    </Stack>
                  ) : null}
                  {quoteTarget && !conversationReadOnly ? (
                    <Paper
                      variant="outlined"
                      sx={{
                        mb: 0.9,
                        p: 0.85,
                        borderRadius: 1.5,
                        bgcolor: '#f3f8ff',
                        borderColor: '#cfe0f7',
                      }}
                    >
                      <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                        <Stack direction="row" spacing={0.7} alignItems="center">
                          <FormatQuoteIcon sx={{ fontSize: 16, color: '#1d4ed8' }} />
                          <Typography variant="caption" sx={{ fontWeight: 700, color: '#0f172a' }}>
                            Zitat: {quoteTarget.senderDisplayName || 'Nachricht'}
                          </Typography>
                        </Stack>
                        <IconButton size="small" onClick={() => setQuoteTarget(null)}>
                          <CloseIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Stack>
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.35, color: '#334155', whiteSpace: 'pre-wrap' }}>
                        {normalizeText(quoteTarget.body).slice(0, 260)}
                      </Typography>
                    </Paper>
                  ) : null}
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                      placeholder={conversationReadOnly ? 'Systemmeldungen sind schreibgeschützt.' : 'Nachricht schreiben…'}
                      size="small"
                      multiline
                      minRows={1}
                      maxRows={4}
                      fullWidth
                      disabled={conversationReadOnly}
                      sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'white' } }}
                    />
                    <Tooltip title="Emoji einfügen">
                      <IconButton onClick={openEmojiMenu} sx={actionButtonSx} disabled={conversationReadOnly}>
                        <InsertEmoticonIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Datei oder Foto senden">
                      <IconButton onClick={() => fileInputRef.current?.click()} sx={actionButtonSx} disabled={conversationReadOnly}>
                        <AttachFileIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Ticket-Link senden">
                      <IconButton onClick={() => void insertTicketLink()} sx={actionButtonSx} disabled={conversationReadOnly}>
                        <LinkIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Senden">
                      <IconButton
                        color="primary"
                        onClick={() => void sendMessage()}
                        disabled={conversationReadOnly}
                        sx={{
                          ...actionButtonSx,
                          bgcolor: '#1d4ed8',
                          borderColor: '#1e40af',
                          color: '#ffffff',
                          '&:hover': {
                            bgcolor: '#1e40af',
                            borderColor: '#1e3a8a',
                            color: '#ffffff',
                          },
                        }}
                      >
                        <SendIcon />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                  {errorMessage ? (
                    <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.7 }}>
                      {errorMessage}
                    </Typography>
                  ) : null}
                  {browserNotifyEnabled && browserPermission !== 'granted' ? (
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: '#475569' }}>
                      Browser-Benachrichtigungen sind noch nicht freigegeben.
                    </Typography>
                  ) : null}
                </Box>
              </>
            ) : (
              <Box sx={{ p: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Wähle eine Unterhaltung links aus.
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    );
  };

  const floatingDimensions = isNarrowScreen
    ? {
        left: 0,
        top: 0,
        width: '100vw',
        height: '100vh',
      }
    : {
        left: floatingPosition.x,
        top: floatingPosition.y,
        width: 980,
        height: 760,
      };
  const selfStatusBadgeLabel =
    connectionState === 'online' ? resolveSelfStatusDisplayLabel(selfPresence) : '⚫ Offline';
  const selfStatusBadgeColor =
    connectionState === 'online' ? resolveSelfStatusColor(selfPresence) : SELF_STATUS_PRESETS.offline.color;

  return (
    <>
      {!detachedView && !embedded && !hideLauncher ? (
        <Tooltip title={`Teamchat öffnen · Status: ${selfStatusBadgeLabel}`}>
          <Fab
            color="primary"
            onClick={() => setOpen((prev) => !prev)}
            sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1450 }}
          >
            <Badge
              overlap="circular"
              variant="dot"
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              sx={{
                '& .MuiBadge-badge': {
                  backgroundColor: selfStatusBadgeColor,
                  width: 12,
                  height: 12,
                  minWidth: 12,
                  border: '2px solid #ffffff',
                  boxShadow: '0 0 0 1px rgba(15,23,42,0.2)',
                },
              }}
            >
              <Badge badgeContent={totalUnread} color="error">
                <ChatIcon />
              </Badge>
            </Badge>
          </Fab>
        </Tooltip>
      ) : null}

      {embedded ? (
        <Box
          sx={{
            height: { xs: 'calc(100vh - 178px)', md: 'calc(100vh - 208px)' },
            minHeight: 560,
            borderRadius: 2,
            overflow: 'hidden',
            border: '1px solid #c5d9f3',
            boxShadow: '0 18px 42px rgba(15,23,42,.22)',
            bgcolor: '#f8fbff',
          }}
        >
          {renderShell()}
        </Box>
      ) : null}

      {chatDisplayMode === 'drawer' && !detachedView && !embedded ? (
        <Drawer
          anchor="right"
          open={open}
          onClose={() => setOpen(false)}
          PaperProps={{
            sx: {
              width: { xs: '100%', sm: 980 },
              maxWidth: '100%',
            },
          }}
        >
          {renderShell()}
        </Drawer>
      ) : null}

      {(chatDisplayMode === 'floating' || detachedView) && open && !embedded ? (
        <Paper
          elevation={24}
          sx={{
            position: 'fixed',
            zIndex: 1500,
            ...floatingDimensions,
            maxWidth: '100vw',
            maxHeight: '100vh',
            borderRadius: isNarrowScreen ? 0 : 2,
            overflow: 'hidden',
            border: '1px solid #c5d9f3',
            backdropFilter: 'blur(5px)',
            boxShadow: '0 24px 58px rgba(15,23,42,.32)',
            resize: isNarrowScreen ? 'none' : 'both',
          }}
        >
          {renderShell()}
        </Paper>
      ) : null}

      {callOverlayVisible ? (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            right: 18,
            bottom: callOverlayBottom,
            zIndex: 1510,
            borderRadius: 2,
            border: '1px solid #bfdbfe',
            bgcolor: '#eff6ff',
            px: 1.2,
            py: 0.9,
            minWidth: 240,
            maxWidth: { xs: 'calc(100vw - 24px)', sm: 460 },
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.28)',
          }}
        >
          {callSession && (callSession.mediaType === 'video' || callSession.videoState === 'requesting' || callSession.videoState === 'on') ? (
            <Box
              sx={{
                mb: 1,
                p: 0.7,
                borderRadius: 1.6,
                border: '1px solid #bfdbfe',
                bgcolor: '#dbeafe',
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  borderRadius: 1.4,
                  overflow: 'hidden',
                  minHeight: 124,
                  bgcolor: '#0f172a',
                }}
              >
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted={false}
                  style={{
                    width: '100%',
                    height: 180,
                    objectFit: 'cover',
                    display: 'block',
                    background: '#0f172a',
                  }}
                />
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  style={{
                    position: 'absolute',
                    right: 8,
                    bottom: 8,
                    width: 92,
                    height: 62,
                    objectFit: 'cover',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.42)',
                    background: '#1e293b',
                  }}
                />
              </Box>
            </Box>
          ) : null}

          <Stack direction="row" spacing={1} alignItems="center">
            <Stack sx={{ minWidth: 0, flex: 1 }} spacing={0.15}>
              <Typography variant="caption" sx={{ color: '#1d4ed8', fontWeight: 700 }}>
                {callSession?.mediaType === 'video' ? 'Aktiver Videoanruf' : 'Aktiver Sprachanruf'}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                {normalizeText(activeCallConversation?.label) || 'Direktchat'}
              </Typography>
              <Typography variant="caption" sx={{ color: '#475569' }} noWrap>
                {callStatusText || 'Verbinden…'}
              </Typography>
            </Stack>

            <Tooltip title={callMuted ? 'Mikrofon einschalten' : 'Mikrofon stummschalten'}>
              <IconButton
                size="small"
                onClick={() => setCallMuted((prev) => !prev)}
                sx={actionButtonSx}
              >
                {callMuted ? <MicOffIcon /> : <MicIcon />}
              </IconButton>
            </Tooltip>
            <Tooltip title={callSpeakerMuted ? 'Audioausgabe einschalten' : 'Audioausgabe stummschalten'}>
              <IconButton
                size="small"
                onClick={() => setCallSpeakerMuted((prev) => !prev)}
                sx={actionButtonSx}
              >
                {callSpeakerMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
              </IconButton>
            </Tooltip>
            {canUseVideoCalls ? (
              <Tooltip
                title={
                  callSession?.mediaType === 'video' || callSession?.videoState === 'requesting' || callSession?.videoState === 'on'
                    ? 'Auf Audio zurückschalten'
                    : 'Video einschalten'
                }
              >
                <IconButton
                  size="small"
                  onClick={() => {
                    if (callSession?.mediaType === 'video' || callSession?.videoState === 'requesting' || callSession?.videoState === 'on') {
                      void downgradeCallToAudio();
                    } else {
                      void upgradeCallToVideo();
                    }
                  }}
                  sx={{
                    ...actionButtonSx,
                    bgcolor:
                      callSession?.mediaType === 'video' || callSession?.videoState === 'requesting' || callSession?.videoState === 'on'
                        ? '#dbeafe'
                        : '#ffffff',
                  }}
                >
                  {callSession?.mediaType === 'video' || callSession?.videoState === 'requesting' || callSession?.videoState === 'on' ? <VideocamOffIcon /> : <VideocamIcon />}
                </IconButton>
              </Tooltip>
            ) : null}
            {callNeedsAudioUnlock && !callSpeakerMuted ? (
              <Tooltip title="Audio jetzt aktivieren">
                <IconButton
                  size="small"
                  onClick={() => void handleEnableCallAudio()}
                  sx={{
                    ...actionButtonSx,
                    bgcolor: '#dbeafe',
                    borderColor: '#60a5fa',
                    color: '#1d4ed8',
                    '&:hover': {
                      bgcolor: '#bfdbfe',
                      borderColor: '#3b82f6',
                      color: '#1e3a8a',
                    },
                  }}
                >
                  <VolumeUpIcon />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title="Call-Debug anzeigen">
              <IconButton size="small" onClick={() => setCallDebugDialogOpen(true)} sx={actionButtonSx}>
                <BugReportIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={hideLauncher ? 'Messenger öffnen' : 'Chat öffnen'}>
              <IconButton
                size="small"
                onClick={openCallConversation}
                sx={actionButtonSx}
              >
                <OpenInNewIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="Anruf beenden">
              <IconButton
                size="small"
                onClick={() => void endCurrentCall('finish', true)}
                sx={{
                  ...actionButtonSx,
                  bgcolor: '#dc2626',
                  borderColor: '#b91c1c',
                  color: '#ffffff',
                  '&:hover': {
                    bgcolor: '#b91c1c',
                    color: '#ffffff',
                    borderColor: '#991b1b',
                  },
                }}
              >
                <CallEndIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Paper>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0] || null;
          event.currentTarget.value = '';
          void handleUploadFile(file);
        }}
      />

      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        preload="auto"
        style={{
          position: 'fixed',
          right: 0,
          bottom: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />

      <Dialog open={Boolean(incomingCall)} onClose={() => void rejectIncomingVoiceCall()} maxWidth="xs" fullWidth>
        <DialogTitle>
          {incomingCall?.mediaType === 'video' ? 'Eingehender Videoanruf' : 'Eingehender Sprachanruf'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.2} sx={{ mt: 0.6 }}>
            <Typography variant="body2" sx={{ color: '#334155' }}>
              {incomingCall ? `${incomingCall.fromLabel} möchte dich anrufen.` : 'Neuer Anruf'}
            </Typography>
            <Chip
              icon={<PhoneInTalkIcon />}
              label={callStatusText || 'Anruf wartet auf Antwort'}
              sx={{
                width: 'fit-content',
                bgcolor: '#f0fdf4',
                border: '1px solid #86efac',
                color: '#14532d',
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => void rejectIncomingVoiceCall()}
            startIcon={<CallEndIcon />}
            sx={{ color: '#b91c1c' }}
          >
            Ablehnen
          </Button>
          <Button
            variant="contained"
            onClick={() => void acceptIncomingVoiceCall()}
            startIcon={<CallIcon />}
            sx={{ bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' } }}
          >
            Annehmen
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={callDebugDialogOpen}
        onClose={() => setCallDebugDialogOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Call-Debug (lokal)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            {callDebugEntries.length === 0 ? (
              <Typography variant="body2" sx={{ color: '#64748b' }}>
                Noch keine Einträge.
              </Typography>
            ) : (
              [...callDebugEntries].reverse().map((entry) => (
                <Box
                  key={entry.id}
                  sx={{
                    p: 1.1,
                    borderRadius: 1.2,
                    border: '1px solid #dbe7fb',
                    bgcolor:
                      entry.category === 'error'
                        ? '#fef2f2'
                        : entry.category === 'state'
                        ? '#eff6ff'
                        : entry.category === 'status'
                        ? '#f8fafc'
                        : '#f0fdf4',
                  }}
                >
                  <Typography variant="caption" sx={{ display: 'block', color: '#475569', fontWeight: 700 }}>
                    {`${new Date(entry.at).toLocaleTimeString('de-DE')} · ${entry.category}`}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.2 }}>
                    {entry.message}
                  </Typography>
                </Box>
              ))
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCallDebugEntries([])} color="inherit">
            Leeren
          </Button>
          <Button onClick={() => setCallDebugDialogOpen(false)} variant="contained">
            Schließen
          </Button>
        </DialogActions>
      </Dialog>

      <Menu
        anchorEl={statusMenuAnchorEl}
        open={Boolean(statusMenuAnchorEl)}
        onClose={closeStatusQuickMenu}
        MenuListProps={{ dense: true }}
      >
        <MenuItem onClick={() => void applyQuickStatus('online', null)}>
          {`${SELF_STATUS_PRESETS.online.emoji} ${SELF_STATUS_PRESETS.online.label}`}
        </MenuItem>
        <MenuItem onClick={() => void applyQuickStatus('away', 30)}>
          {`${SELF_STATUS_PRESETS.away.emoji} ${SELF_STATUS_PRESETS.away.label} · 30 Min`}
        </MenuItem>
        <MenuItem onClick={() => void applyQuickStatus('dnd', 60)}>
          {`${SELF_STATUS_PRESETS.dnd.emoji} ${SELF_STATUS_PRESETS.dnd.label} · 1 Std`}
        </MenuItem>
        <MenuItem onClick={() => void applyQuickStatus('offline', null)}>
          {`${SELF_STATUS_PRESETS.offline.emoji} ${SELF_STATUS_PRESETS.offline.label}`}
        </MenuItem>
        <Divider sx={{ my: 0.3 }} />
        <MenuItem onClick={openPresenceDialog}>Status anpassen…</MenuItem>
      </Menu>

      <Dialog open={presenceDialogOpen} onClose={closePresenceDialog} fullWidth maxWidth="xs">
        <DialogTitle>Mein Chat-Status</DialogTitle>
        <DialogContent>
          <Stack spacing={1.7} sx={{ mt: 1 }}>
            <Box>
              <Typography variant="caption" sx={{ color: '#475569', fontWeight: 700 }}>
                Schnellstatus
              </Typography>
              <Box
                sx={{
                  mt: 0.7,
                  display: 'grid',
                  gap: 0.8,
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                }}
              >
                {(['online', 'away', 'dnd', 'offline', 'custom'] as ChatSelfStatusKey[]).map((statusKey) => {
                  const statusMeta =
                    statusKey === 'custom'
                      ? {
                          label: 'Benutzerdefiniert',
                          emoji: '💬',
                          color: '#0ea5e9',
                          description: 'Eigener Text und Farbe',
                        }
                      : SELF_STATUS_PRESETS[statusKey];
                  const selected = presenceDraft.status === statusKey;
                  return (
                    <Paper
                      key={`presence-preset-${statusKey}`}
                      variant="outlined"
                      onClick={() => {
                        setPresenceDraft((current) => {
                          if (statusKey === 'custom') {
                            return {
                              status: 'custom',
                              label: normalizeText(current.label) || 'Benutzerdefiniert',
                              color: sanitizePresenceColor(current.color, '#0ea5e9'),
                              emoji: normalizeText(current.emoji) || '💬',
                              expiresAt: current.expiresAt || null,
                            };
                          }
                          return {
                            status: statusKey,
                            label: '',
                            color: SELF_STATUS_PRESETS[statusKey].color,
                            emoji: SELF_STATUS_PRESETS[statusKey].emoji,
                            expiresAt: current.expiresAt || null,
                          };
                        });
                      }}
                      sx={{
                        cursor: 'pointer',
                        px: 1.1,
                        py: 0.85,
                        borderRadius: 1.8,
                        borderColor: selected ? '#93c5fd' : '#d8e2ef',
                        bgcolor: selected ? '#eaf3ff' : '#ffffff',
                        boxShadow: selected ? '0 0 0 1px rgba(59,130,246,.24), 0 6px 14px rgba(37,99,235,.12)' : 'none',
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                        {statusMeta.emoji} {statusMeta.label}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        {statusMeta.description}
                      </Typography>
                    </Paper>
                  );
                })}
              </Box>
            </Box>

            <Box>
              <TextField
                label="Status-Emoji"
                value={presenceDraft.emoji}
                onChange={(event) =>
                  setPresenceDraft((current) => ({
                    ...current,
                    emoji: Array.from(String(event.target.value || '').replace(/\s+/g, ' ')).slice(0, 6).join(''),
                  }))
                }
                placeholder="🟢"
                fullWidth
              />
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.6, flexWrap: 'wrap' }}>
                {PRESENCE_EMOJI_SUGGESTIONS.map((emoji) => (
                  <Button
                    key={`presence-emoji-${emoji}`}
                    size="small"
                    onClick={() => setPresenceDraft((current) => ({ ...current, emoji }))}
                    sx={{ minWidth: 0, px: 1, fontSize: 18 }}
                  >
                    {emoji}
                  </Button>
                ))}
              </Stack>
            </Box>

            {presenceDraft.status === 'custom' ? (
              <>
                <TextField
                  label="Eigener Status-Text"
                  value={presenceDraft.label}
                  onChange={(event) =>
                    setPresenceDraft((current) => ({
                      ...current,
                      label: String(event.target.value || '').slice(0, 80),
                    }))
                  }
                  placeholder="z. B. Fokuszeit bis 14:00"
                />
                <Stack direction="row" spacing={1.2} alignItems="center">
                  <TextField
                    type="color"
                    label="Farbe"
                    value={sanitizePresenceColor(presenceDraft.color, '#0ea5e9')}
                    onChange={(event) =>
                      setPresenceDraft((current) => ({
                        ...current,
                        color: sanitizePresenceColor(event.target.value, '#0ea5e9'),
                      }))
                    }
                    sx={{ width: 120 }}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="Hex"
                    value={presenceDraft.color}
                    onChange={(event) =>
                      setPresenceDraft((current) => ({
                        ...current,
                        color: String(event.target.value || '').slice(0, 16),
                      }))
                    }
                    placeholder="#0ea5e9"
                    fullWidth
                  />
                </Stack>
              </>
            ) : null}

            <Box>
              <Typography variant="caption" sx={{ color: '#475569', fontWeight: 700 }}>
                Status automatisch zurücksetzen
              </Typography>
              <Stack direction="row" spacing={0.6} sx={{ mt: 0.65, flexWrap: 'wrap' }}>
                {PRESENCE_QUICK_EXPIRY_OPTIONS.map((option) => {
                  const selected =
                    option.minutes === null
                      ? !presenceDraft.expiresAt
                      : (() => {
                          if (!presenceDraft.expiresAt) return false;
                          const diff = Math.abs(new Date(presenceDraft.expiresAt).getTime() - (Date.now() + option.minutes * 60 * 1000));
                          return diff < 2 * 60 * 1000;
                        })();
                  return (
                    <Chip
                      key={`presence-expiry-${option.id}`}
                      label={option.label}
                      size="small"
                      clickable
                      onClick={() => applyPresenceExpiryMinutes(option.minutes)}
                      color={selected ? 'primary' : 'default'}
                      variant={selected ? 'filled' : 'outlined'}
                    />
                  );
                })}
              </Stack>
              <TextField
                type="datetime-local"
                label="Eigene Ablaufzeit"
                value={toPresenceLocalDateTimeValue(presenceDraft.expiresAt)}
                onChange={(event) =>
                  setPresenceDraft((current) => ({
                    ...current,
                    expiresAt: fromPresenceLocalDateTimeValue(String(event.target.value || '')),
                  }))
                }
                InputLabelProps={{ shrink: true }}
                fullWidth
                sx={{ mt: 1.05 }}
              />
            </Box>

            <Chip
              label={`${resolveSelfStatusDisplayLabel(presenceDraft)}${
                formatPresenceExpiryLabel(presenceDraft.expiresAt) ? ` · ${formatPresenceExpiryLabel(presenceDraft.expiresAt)}` : ''
              }`}
              sx={{
                width: 'fit-content',
                border: '1px solid #d5e3f5',
                bgcolor: '#f8fbff',
                '&::before': {
                  content: '""',
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '999px',
                  backgroundColor: resolveSelfStatusColor(presenceDraft),
                  marginLeft: 10,
                  marginRight: 8,
                },
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closePresenceDialog} disabled={presenceSaving}>
            Abbrechen
          </Button>
          <Button
            variant="contained"
            onClick={() => void savePresenceSettings(presenceDraft)}
            disabled={
              presenceSaving ||
              (presenceDraft.status === 'custom' && !normalizeText(presenceDraft.label)) ||
              (!!normalizeText(presenceDraft.expiresAt) && new Date(String(presenceDraft.expiresAt)).getTime() <= Date.now())
            }
          >
            {presenceSaving ? 'Speichert…' : 'Status speichern'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={createGroupOpen} onClose={() => setCreateGroupOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Freie Gruppe erstellen</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Gruppenname"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              fullWidth
            />
            <Select
              multiple
              value={newGroupMembers}
              onChange={(event) => {
                const values = event.target.value;
                setNewGroupMembers(Array.isArray(values) ? values.map((entry) => String(entry)) : []);
              }}
              fullWidth
              displayEmpty
              renderValue={(selected) =>
                selected.length === 0
                  ? 'Mitglieder auswählen'
                  : `${selected.length} Mitglied(er) gewählt`
              }
            >
              {(bootstrap?.contacts || [])
                .filter((contact) => contact.id !== bootstrap?.me.id)
                .map((contact) => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {contact.displayName}
                  </MenuItem>
                ))}
            </Select>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateGroupOpen(false)}>Abbrechen</Button>
          <Button variant="contained" onClick={() => void handleCreateCustomGroup()}>
            Gruppe erstellen
          </Button>
        </DialogActions>
      </Dialog>

      <Menu
        anchorEl={emojiMenuAnchorEl}
        open={Boolean(emojiMenuAnchorEl)}
        onClose={closeEmojiMenu}
        MenuListProps={{ dense: true }}
      >
        <Box sx={{ px: 1, py: 0.5, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(30px, 1fr))', gap: 0.35 }}>
          {COMMON_CHAT_EMOJIS.map((emoji) => (
            <Button
              key={`emoji-${emoji}`}
              onClick={() => insertEmojiIntoDraft(emoji)}
              sx={{ minWidth: 0, px: 0.9, py: 0.4, fontSize: 18 }}
            >
              {emoji}
            </Button>
          ))}
        </Box>
      </Menu>

      <Menu
        anchorEl={reactionMenuAnchorEl}
        open={Boolean(reactionMenuAnchorEl)}
        onClose={closeReactionMenu}
        MenuListProps={{ dense: true }}
      >
        <Box sx={{ px: 1, py: 0.5, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(30px, 1fr))', gap: 0.35 }}>
          {COMMON_CHAT_EMOJIS.map((emoji) => (
            <Button
              key={`react-${emoji}`}
              onClick={() => void handleReactionEmojiPick(emoji)}
              sx={{ minWidth: 0, px: 0.9, py: 0.4, fontSize: 18 }}
            >
              {emoji}
            </Button>
          ))}
        </Box>
      </Menu>
    </>
  );
};

export default AdminChatOverlay;
