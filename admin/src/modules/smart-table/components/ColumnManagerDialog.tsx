import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import type { SmartTableColumnDef, SmartTableRow } from '../types';

interface ColumnManagerDialogProps<Row extends SmartTableRow> {
  open: boolean;
  columns: SmartTableColumnDef<Row>[];
  visibilityModel: Record<string, boolean>;
  columnOrder: string[];
  onClose: () => void;
  onApply: (input: { visibilityModel: Record<string, boolean>; columnOrder: string[] }) => void;
}

function moveAt<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);
  return next;
}

function resolveColumnLabel<Row extends SmartTableRow>(column: SmartTableColumnDef<Row>): string {
  if (typeof column.headerName === 'string' && column.headerName.trim()) return column.headerName;
  return String(column.field || '').trim();
}

const ColumnManagerDialog = <Row extends SmartTableRow>(props: ColumnManagerDialogProps<Row>) => {
  const { open, columns, visibilityModel, columnOrder, onClose, onApply } = props;
  const [draftVisibility, setDraftVisibility] = useState<Record<string, boolean>>({});
  const [draftOrder, setDraftOrder] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setDraftVisibility({ ...visibilityModel });
    setDraftOrder([...columnOrder]);
  }, [columnOrder, open, visibilityModel]);

  const orderedColumns = useMemo(() => {
    const byField = new Map(columns.map((column) => [String(column.field || '').trim(), column]));
    const ordered = draftOrder
      .map((field) => byField.get(field))
      .filter((column): column is SmartTableColumnDef<Row> => !!column);

    columns.forEach((column) => {
      const field = String(column.field || '').trim();
      if (!field) return;
      if (!ordered.some((entry) => entry.field === field)) {
        ordered.push(column);
      }
    });
    return ordered;
  }, [columns, draftOrder]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Spalten konfigurieren</DialogTitle>
      <DialogContent dividers>
        <List dense>
          {orderedColumns.map((column, index) => {
            const field = String(column.field || '').trim();
            const hideable = column.hideable !== false && column.lockVisibility !== true;
            const visible = draftVisibility[field] !== false;

            return (
              <ListItem key={field} divider>
                <Checkbox
                  disabled={!hideable}
                  checked={visible}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setDraftVisibility((current) => ({
                      ...current,
                      [field]: checked,
                    }));
                  }}
                />
                <ListItemText
                  primary={resolveColumnLabel(column)}
                  secondary={field}
                />
                <ListItemSecondaryAction>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <IconButton
                      size="small"
                      onClick={() => setDraftOrder((current) => moveAt(current, index, index - 1))}
                      disabled={index === 0}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => setDraftOrder((current) => moveAt(current, index, index + 1))}
                      disabled={index >= orderedColumns.length - 1}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </ListItemSecondaryAction>
              </ListItem>
            );
          })}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button
          variant="contained"
          onClick={() => {
            onApply({ visibilityModel: draftVisibility, columnOrder: draftOrder });
            onClose();
          }}
        >
          Übernehmen
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ColumnManagerDialog;
