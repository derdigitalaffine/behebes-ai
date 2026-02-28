import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import PublishRoundedIcon from '@mui/icons-material/PublishRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { getAdminToken } from '../lib/auth';

type BlogStatus = 'draft' | 'scheduled' | 'published' | 'archived';

type BlogFilterStatus = 'all' | BlogStatus;

interface PlatformBlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  contentMd: string;
  status: BlogStatus;
  effectiveStatus: BlogStatus;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface EditorState {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  contentMd: string;
  status: BlogStatus;
  publishedAtLocal: string;
}

const DEFAULT_EDITOR: EditorState = {
  id: '',
  title: '',
  slug: '',
  excerpt: '',
  contentMd: '',
  status: 'draft',
  publishedAtLocal: '',
};

const STATUS_OPTIONS: Array<{ value: BlogFilterStatus; label: string }> = [
  { value: 'all', label: 'Alle Status' },
  { value: 'draft', label: 'Entwurf' },
  { value: 'scheduled', label: 'Geplant' },
  { value: 'published', label: 'Veröffentlicht' },
  { value: 'archived', label: 'Archiviert' },
];

const STATUS_LABELS: Record<BlogStatus, string> = {
  draft: 'Entwurf',
  scheduled: 'Geplant',
  published: 'Veröffentlicht',
  archived: 'Archiviert',
};

const statusChipColor = (status: BlogStatus): 'default' | 'primary' | 'success' | 'warning' => {
  if (status === 'published') return 'success';
  if (status === 'scheduled') return 'warning';
  if (status === 'archived') return 'default';
  return 'primary';
};

const slugify = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160);

const toLocalInput = (value?: string | null): string => {
  if (!value) return '';
  const parsed = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const toIsoFromLocalInput = (value: string): string | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const formatDate = (value?: string | null): string => {
  if (!value) return '–';
  const parsed = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return '–';
  return parsed.toLocaleString('de-DE');
};

const PlatformBlog: React.FC = () => {
  const token = getAdminToken();
  const [items, setItems] = useState<PlatformBlogPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});
  const [filterStatus, setFilterStatus] = useState<BlogFilterStatus>('all');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<'edit' | 'preview'>('edit');
  const [editor, setEditor] = useState<EditorState>(DEFAULT_EDITOR);
  const [slugTouched, setSlugTouched] = useState(false);

  const limit = 30;

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
    }),
    [token]
  );

  const resetEditor = () => {
    setEditor(DEFAULT_EDITOR);
    setSlugTouched(false);
    setEditorTab('edit');
  };

  const loadPosts = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get('/api/admin/platform-blog', {
        headers,
        params: {
          status: filterStatus,
          search: search.trim() || undefined,
          limit,
          offset: 0,
        },
      });
      const payloadItems = Array.isArray(response.data?.items) ? response.data.items : [];
      setItems(payloadItems);
      setTotal(Number(response.data?.total || payloadItems.length || 0));
      setError('');
    } catch (err: unknown) {
      const nextError = axios.isAxiosError(err)
        ? err.response?.data?.message || 'Plattform-Blog konnte nicht geladen werden.'
        : 'Plattform-Blog konnte nicht geladen werden.';
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, headers, search, token]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  const openCreateDialog = () => {
    resetEditor();
    setEditorOpen(true);
  };

  const openEditDialog = (post: PlatformBlogPost) => {
    setEditor({
      id: post.id,
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      contentMd: post.contentMd,
      status: post.status,
      publishedAtLocal: toLocalInput(post.publishedAt),
    });
    setSlugTouched(true);
    setEditorTab('edit');
    setEditorOpen(true);
  };

  const closeDialog = () => {
    setEditorOpen(false);
    setSaving(false);
    resetEditor();
  };

  const handleSave = async () => {
    if (!token) return;
    const payload = {
      title: editor.title,
      slug: editor.slug,
      excerpt: editor.excerpt,
      contentMd: editor.contentMd,
      status: editor.status,
      publishedAt: toIsoFromLocalInput(editor.publishedAtLocal),
    };

    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (editor.id) {
        await axios.patch(`/api/admin/platform-blog/${encodeURIComponent(editor.id)}`, payload, { headers });
        setMessage('Blogbeitrag aktualisiert.');
      } else {
        await axios.post('/api/admin/platform-blog', payload, { headers });
        setMessage('Blogbeitrag erstellt.');
      }
      closeDialog();
      await loadPosts();
    } catch (err: unknown) {
      const nextError = axios.isAxiosError(err)
        ? err.response?.data?.message || 'Blogbeitrag konnte nicht gespeichert werden.'
        : 'Blogbeitrag konnte nicht gespeichert werden.';
      setError(nextError);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (post: PlatformBlogPost) => {
    if (!token) return;
    if (!window.confirm(`Beitrag "${post.title}" wirklich löschen?`)) return;
    setDeletingIds((current) => ({ ...current, [post.id]: true }));
    setError('');
    setMessage('');
    try {
      await axios.delete(`/api/admin/platform-blog/${encodeURIComponent(post.id)}`, { headers });
      setMessage('Blogbeitrag gelöscht.');
      await loadPosts();
    } catch (err: unknown) {
      const nextError = axios.isAxiosError(err)
        ? err.response?.data?.message || 'Blogbeitrag konnte nicht gelöscht werden.'
        : 'Blogbeitrag konnte nicht gelöscht werden.';
      setError(nextError);
    } finally {
      setDeletingIds((current) => ({ ...current, [post.id]: false }));
    }
  };

  return (
    <Box>
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Plattform-Newsblog
        </Typography>
        <Typography variant="body2" sx={{ color: 'var(--admin-text-muted)' }}>
          Veröffentlichungen für das öffentliche Platformportal. Unterstützt Entwürfe, Rückdatierung und geplante Veröffentlichungen.
        </Typography>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {message && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ md: 'center' }}>
          <TextField
            select
            size="small"
            label="Status"
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value as BlogFilterStatus)}
            sx={{ minWidth: 170 }}
          >
            {STATUS_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Suche"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Titel, Excerpt, Slug"
            sx={{ flex: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={() => void loadPosts()}
            disabled={loading}
          >
            Aktualisieren
          </Button>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openCreateDialog}>
            Neuer Beitrag
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Titel</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Veröffentlichung</TableCell>
                <TableCell>Aktualisiert</TableCell>
                <TableCell align="right">Aktionen</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5}>Lade Beiträge...</TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>Keine Beiträge gefunden.</TableCell>
                </TableRow>
              ) : (
                items.map((post) => (
                  <TableRow key={post.id} hover>
                    <TableCell>
                      <Stack spacing={0.35}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {post.title}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'var(--admin-text-muted)' }}>
                          /{post.slug}
                        </Typography>
                        {post.excerpt && (
                          <Typography variant="caption" sx={{ color: 'var(--admin-text-muted)' }}>
                            {post.excerpt}
                          </Typography>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.8} alignItems="center">
                        <Chip
                          size="small"
                          color={statusChipColor(post.status)}
                          label={STATUS_LABELS[post.status]}
                          variant={post.status === 'archived' ? 'outlined' : 'filled'}
                        />
                        {post.effectiveStatus !== post.status && (
                          <Chip size="small" variant="outlined" label={`aktiv: ${STATUS_LABELS[post.effectiveStatus]}`} />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>{formatDate(post.publishedAt)}</TableCell>
                    <TableCell>{formatDate(post.updatedAt)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.6} justifyContent="flex-end">
                        <Tooltip title="Bearbeiten">
                          <IconButton size="small" onClick={() => openEditDialog(post)}>
                            <EditRoundedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Löschen">
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              disabled={!!deletingIds[post.id]}
                              onClick={() => void handleDelete(post)}
                            >
                              <DeleteOutlineRoundedIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Typography variant="caption" sx={{ display: 'block', mt: 1.2, color: 'var(--admin-text-muted)' }}>
        {total} Beitrag/Beiträge geladen (max. {limit} pro Anfrage).
      </Typography>

      <Dialog open={editorOpen} onClose={closeDialog} maxWidth="lg" fullWidth>
        <DialogTitle>
          {editor.id ? 'Blogbeitrag bearbeiten' : 'Neuen Blogbeitrag erstellen'}
        </DialogTitle>
        <DialogContent dividers>
          <Tabs value={editorTab} onChange={(_, value) => setEditorTab(value)} sx={{ mb: 2 }}>
            <Tab value="edit" label="Editor" />
            <Tab value="preview" label="Vorschau" />
          </Tabs>

          {editorTab === 'edit' ? (
            <Stack spacing={1.4}>
              <TextField
                label="Titel"
                value={editor.title}
                onChange={(event) => {
                  const nextTitle = event.target.value;
                  setEditor((current) => ({
                    ...current,
                    title: nextTitle,
                    slug: slugTouched ? current.slug : slugify(nextTitle),
                  }));
                }}
                fullWidth
                required
              />
              <TextField
                label="Slug"
                value={editor.slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setEditor((current) => ({
                    ...current,
                    slug: slugify(event.target.value),
                  }));
                }}
                fullWidth
                helperText="Wird in der öffentlichen Blog-URL verwendet."
              />
              <TextField
                label="Kurzbeschreibung"
                value={editor.excerpt}
                onChange={(event) => setEditor((current) => ({ ...current, excerpt: event.target.value }))}
                fullWidth
                multiline
                minRows={2}
              />
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2}>
                <TextField
                  select
                  label="Status"
                  value={editor.status}
                  onChange={(event) => setEditor((current) => ({ ...current, status: event.target.value as BlogStatus }))}
                  sx={{ minWidth: 210 }}
                >
                  {STATUS_OPTIONS.filter((entry) => entry.value !== 'all').map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Veröffentlichungszeitpunkt"
                  type="datetime-local"
                  value={editor.publishedAtLocal}
                  onChange={(event) =>
                    setEditor((current) => ({
                      ...current,
                      publishedAtLocal: event.target.value,
                    }))
                  }
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  helperText="Für geplante Beiträge erforderlich. Für Rückdatierung einfach einen Zeitpunkt in der Vergangenheit setzen."
                />
              </Stack>
              <Typography variant="caption" sx={{ color: 'var(--admin-text-muted)' }}>
                Tipp: "Veröffentlicht" + Zeit in der Vergangenheit = rückdatiert. "Geplant" + Zeit in der Zukunft = zeitgesteuerte Veröffentlichung.
              </Typography>
              <TextField
                label="Inhalt (Markdown)"
                value={editor.contentMd}
                onChange={(event) => setEditor((current) => ({ ...current, contentMd: event.target.value }))}
                fullWidth
                required
                multiline
                minRows={13}
              />
            </Stack>
          ) : (
            <Stack spacing={1.1}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {editor.title || 'Titelvorschau'}
              </Typography>
              <Stack direction="row" spacing={0.8} alignItems="center">
                <Chip size="small" color={statusChipColor(editor.status)} label={STATUS_LABELS[editor.status]} />
                {editor.publishedAtLocal ? (
                  <Typography variant="caption" sx={{ color: 'var(--admin-text-muted)' }}>
                    geplant/gesetzt: {formatDate(toIsoFromLocalInput(editor.publishedAtLocal))}
                  </Typography>
                ) : null}
              </Stack>
              {editor.excerpt && (
                <Typography variant="body2" sx={{ color: 'var(--admin-text-muted)' }}>
                  {editor.excerpt}
                </Typography>
              )}
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '0.86rem',
                  lineHeight: 1.6,
                }}
              >
                {editor.contentMd || 'Noch kein Inhalt.'}
              </Paper>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            variant="outlined"
            startIcon={<PublishRoundedIcon />}
            disabled={saving}
            onClick={() => {
              const now = new Date();
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const day = String(now.getDate()).padStart(2, '0');
              const hours = String(now.getHours()).padStart(2, '0');
              const minutes = String(now.getMinutes()).padStart(2, '0');
              setEditor((current) => ({
                ...current,
                status: 'published',
                publishedAtLocal: `${year}-${month}-${day}T${hours}:${minutes}`,
              }));
            }}
          >
            Jetzt veröffentlichen
          </Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Speichere...' : editor.id ? 'Aktualisieren' : 'Erstellen'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PlatformBlog;
