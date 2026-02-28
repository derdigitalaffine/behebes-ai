import React, { useState } from 'react';
import {
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import type { SmartTableSavedView } from '../types';

interface SavedViewsMenuProps {
  savedViews: SmartTableSavedView[];
  onSaveCurrent: (name: string) => void;
  onApplyView: (viewId: string) => void;
  onDeleteView: (viewId: string) => void;
  onResetView: () => void;
}

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unbekannt';
  return date.toLocaleString('de-DE', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const SavedViewsMenu: React.FC<SavedViewsMenuProps> = ({
  savedViews,
  onSaveCurrent,
  onApplyView,
  onDeleteView,
  onResetView,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleSaveClick = () => {
    const name = window.prompt('Ansicht speichern unter Name', 'Meine Ansicht');
    if (!name || !name.trim()) return;
    onSaveCurrent(name.trim());
  };

  return (
    <>
      <Button
        className="smart-table-toolbar-btn smart-table-views-btn"
        size="small"
        variant="outlined"
        startIcon={<ViewListOutlinedIcon fontSize="small" />}
        onClick={(event) => setAnchorEl(event.currentTarget)}
      >
        Ansichten
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            handleSaveClick();
          }}
        >
          <ListItemIcon>
            <SaveOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Aktuelle Ansicht speichern</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onResetView();
          }}
        >
          <ListItemIcon>
            <RestartAltOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Auf Standard zurücksetzen</ListItemText>
        </MenuItem>

        <Divider />

        {savedViews.length === 0 ? (
          <MenuItem disabled>
            <ListItemText>Keine gespeicherten Ansichten</ListItemText>
          </MenuItem>
        ) : (
          savedViews.map((view) => (
            <MenuItem
              key={view.id}
              onClick={() => {
                setAnchorEl(null);
                onApplyView(view.id);
              }}
              sx={{ minWidth: 280 }}
            >
              <ListItemText
                primary={view.name}
                secondary={`Aktualisiert: ${formatDateTime(view.updatedAt)}`}
              />
              <Button
                size="small"
                color="error"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteView(view.id);
                }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </Button>
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  );
};

export default SavedViewsMenu;
