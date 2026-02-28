import React from 'react';
import { CircularProgress, IconButton, Tooltip } from '@mui/material';

export type SmartTableRowActionTone = 'default' | 'primary' | 'danger' | 'warning' | 'success';

interface SmartTableRowActionButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: SmartTableRowActionTone;
  size?: 'small' | 'medium';
}

export const SmartTableRowActions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="smart-table-row-actions">{children}</div>
);

const SmartTableRowActionButton: React.FC<SmartTableRowActionButtonProps> = ({
  label,
  icon,
  onClick,
  disabled = false,
  loading = false,
  tone = 'default',
  size = 'small',
}) => {
  const resolvedDisabled = disabled || loading;

  return (
    <Tooltip title={label} arrow enterDelay={180}>
      <span className="smart-table-row-action-btn-wrap">
        <IconButton
          size={size}
          className={`smart-table-row-action-btn smart-table-row-action-btn-${tone}`}
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            onClick?.(event);
          }}
          disabled={resolvedDisabled}
        >
          {loading ? <CircularProgress size={14} thickness={5} color="inherit" /> : icon}
        </IconButton>
      </span>
    </Tooltip>
  );
};

export default SmartTableRowActionButton;
