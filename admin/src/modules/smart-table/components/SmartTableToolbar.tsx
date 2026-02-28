import React from 'react';
import {
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import ViewAgendaIcon from '@mui/icons-material/ViewAgenda';
import TableRowsIcon from '@mui/icons-material/TableRows';
import PrintIcon from '@mui/icons-material/Print';
import StayCurrentLandscapeIcon from '@mui/icons-material/StayCurrentLandscape';
import StayCurrentPortraitIcon from '@mui/icons-material/StayCurrentPortrait';
import type {
  SmartTableLiveState,
  SmartTableLayoutMode,
  SmartTablePrintOrientation,
  SmartTableTextSize,
} from '../types';

interface SmartTableToolbarProps {
  title?: string;
  totalCount?: number;
  search: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  liveState?: SmartTableLiveState;
  layoutMode: SmartTableLayoutMode;
  onLayoutModeChange: (mode: SmartTableLayoutMode) => void;
  textSize: SmartTableTextSize;
  onTextSizeChange: (size: SmartTableTextSize) => void;
  lastEventAt?: string | null;
  lastSyncAt?: string | null;
  onManageColumns: () => void;
  viewsMenu?: React.ReactNode;
  startActions?: React.ReactNode;
  endActions?: React.ReactNode;
  printOrientation?: SmartTablePrintOrientation;
  onPrintOrientationChange?: (orientation: SmartTablePrintOrientation) => void;
  onPrint?: () => void;
  printDisabled?: boolean;
  printTooltip?: string;
}

function formatTime(value?: string | null): string {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function resolveLiveChip(liveState?: SmartTableLiveState): { label: string; color: 'success' | 'warning' | 'default' } {
  if (liveState === 'live') return { label: 'live', color: 'success' };
  if (liveState === 'reconnecting') return { label: 'reconnecting', color: 'warning' };
  return { label: 'polling', color: 'default' };
}

function getTextSizeLabel(size: SmartTableTextSize): string {
  if (size === 'sm') return 'Klein';
  if (size === 'lg') return 'Groß';
  return 'Mittel';
}

const SmartTableToolbar: React.FC<SmartTableToolbarProps> = ({
  title,
  totalCount,
  search,
  onSearchChange,
  onRefresh,
  isRefreshing,
  liveState,
  layoutMode,
  onLayoutModeChange,
  textSize,
  onTextSizeChange,
  lastEventAt,
  lastSyncAt,
  onManageColumns,
  viewsMenu,
  startActions,
  endActions,
  printOrientation,
  onPrintOrientationChange,
  onPrint,
  printDisabled = false,
  printTooltip = 'Tabelle als A4 drucken',
}) => {
  const liveChip = resolveLiveChip(liveState);

  return (
    <Stack
      spacing={1.4}
      sx={{
        p: 1.5,
        borderBottom: '1px solid var(--admin-border)',
        background: 'linear-gradient(180deg, rgba(248, 251, 255, 0.88) 0%, rgba(248, 251, 255, 0.42) 100%)',
      }}
    >
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }} spacing={1.5}>
        <Box>
          {title && (
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
          )}
          {typeof totalCount === 'number' && (
            <Typography variant="body2" sx={{ color: 'var(--admin-text-muted)' }}>
              {totalCount} Einträge
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
          {startActions}
          {viewsMenu}
          <Tooltip title="Tabellenansicht">
            <ToggleButtonGroup
              className="smart-table-toolbar-toggle-group"
              size="small"
              exclusive
              value={layoutMode}
              onChange={(_event, nextMode: SmartTableLayoutMode | null) => {
                if (!nextMode) return;
                onLayoutModeChange(nextMode);
              }}
              aria-label="Tabellenansicht"
            >
              <ToggleButton className="smart-table-toolbar-toggle" value="compact" aria-label="Kompakt" sx={{ px: 0.85 }}>
                <TableRowsIcon fontSize="small" />
              </ToggleButton>
              <ToggleButton className="smart-table-toolbar-toggle" value="expanded" aria-label="Erweitert" sx={{ px: 0.85 }}>
                <ViewAgendaIcon fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </Tooltip>
          <Stack direction="row" spacing={0.6} alignItems="center">
            <Tooltip title="Schriftgröße direkt wählen">
              <ToggleButtonGroup
                className="smart-table-toolbar-toggle-group"
                size="small"
                exclusive
                value={textSize}
                onChange={(_event, nextSize: SmartTableTextSize | null) => {
                  if (!nextSize) return;
                  onTextSizeChange(nextSize);
                }}
                aria-label="Tabellen-Schriftgröße"
              >
                <ToggleButton className="smart-table-toolbar-toggle" value="sm" aria-label="Kleine Schrift" sx={{ px: 0.85, fontWeight: 700 }}>
                  A-
                </ToggleButton>
                <ToggleButton className="smart-table-toolbar-toggle" value="md" aria-label="Normale Schrift" sx={{ px: 0.85, fontWeight: 700 }}>
                  A
                </ToggleButton>
                <ToggleButton className="smart-table-toolbar-toggle" value="lg" aria-label="Große Schrift" sx={{ px: 0.85, fontWeight: 700 }}>
                  A+
                </ToggleButton>
              </ToggleButtonGroup>
            </Tooltip>
            <Chip className="smart-table-toolbar-chip smart-table-toolbar-chip-muted" size="small" variant="outlined" label={`Schrift: ${getTextSizeLabel(textSize)}`} />
          </Stack>
          <Button className="smart-table-toolbar-btn" size="small" variant="outlined" startIcon={<ViewColumnIcon fontSize="small" />} onClick={onManageColumns}>
            Spalten
          </Button>
          {onPrint ? (
            <>
              {printOrientation && onPrintOrientationChange ? (
                <Tooltip title="A4-Format">
                  <ToggleButtonGroup
                    className="smart-table-toolbar-toggle-group"
                    size="small"
                    exclusive
                    value={printOrientation}
                    onChange={(_event, nextOrientation: SmartTablePrintOrientation | null) => {
                      if (!nextOrientation) return;
                      onPrintOrientationChange(nextOrientation);
                    }}
                    aria-label="A4-Druckformat"
                  >
                    <ToggleButton className="smart-table-toolbar-toggle" value="portrait" aria-label="A4 Hochformat" sx={{ px: 0.85 }}>
                      <StayCurrentPortraitIcon fontSize="small" />
                    </ToggleButton>
                    <ToggleButton className="smart-table-toolbar-toggle" value="landscape" aria-label="A4 Querformat" sx={{ px: 0.85 }}>
                      <StayCurrentLandscapeIcon fontSize="small" />
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Tooltip>
              ) : null}
              <Tooltip title={printTooltip}>
                <span>
                  <Button
                    className="smart-table-toolbar-btn"
                    size="small"
                    variant="outlined"
                    startIcon={<PrintIcon fontSize="small" />}
                    onClick={onPrint}
                    disabled={printDisabled}
                  >
                    Drucken
                  </Button>
                </span>
              </Tooltip>
            </>
          ) : null}
          <Button
            className="smart-table-toolbar-btn smart-table-toolbar-btn-primary"
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon fontSize="small" />}
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? 'Aktualisiere...' : 'Refresh'}
          </Button>
          {endActions}
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.2} alignItems={{ xs: 'stretch', lg: 'center' }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Suchen..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Chip className="smart-table-toolbar-chip smart-table-toolbar-chip-live" size="small" color={liveChip.color} label={liveChip.label} />
          <Chip className="smart-table-toolbar-chip smart-table-toolbar-chip-muted" size="small" variant="outlined" label={`Event ${formatTime(lastEventAt)}`} />
          <Chip className="smart-table-toolbar-chip smart-table-toolbar-chip-muted" size="small" variant="outlined" label={`Sync ${formatTime(lastSyncAt)}`} />
        </Stack>
      </Stack>
    </Stack>
  );
};

export default SmartTableToolbar;
