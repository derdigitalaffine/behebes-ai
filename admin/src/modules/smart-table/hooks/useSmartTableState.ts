import { useEffect, useMemo, useState } from 'react';
import type { GridFilterModel, GridSortModel } from '@mui/x-data-grid';
import {
  loadSmartTableState,
  saveSmartTableState,
} from '../storage/localStorageAdapter';
import type {
  SmartTableColumnDef,
  SmartTablePersistedState,
  SmartTableRow,
  SmartTableSavedView,
  SmartTableViewState,
} from '../types';
import { SMART_TABLE_STORAGE_VERSION } from '../types';

interface UseSmartTableStateOptions<Row extends SmartTableRow> {
  tableId: string;
  userId?: string;
  columns: SmartTableColumnDef<Row>[];
  defaultPageSize?: number;
}

interface ApplyViewInput {
  columnVisibilityModel?: Record<string, boolean>;
  columnOrder?: string[];
  sortModel?: GridSortModel;
  filterModel?: GridFilterModel;
  pageSize?: number;
  layoutMode?: SmartTableViewState['layoutMode'];
  textSize?: SmartTableViewState['textSize'];
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function createDefaultView<Row extends SmartTableRow>(
  columns: SmartTableColumnDef<Row>[],
  defaultPageSize: number
): SmartTableViewState {
  const columnVisibilityModel: Record<string, boolean> = {};
  const columnOrder: string[] = [];

  columns.forEach((column) => {
    const field = String(column.field || '').trim();
    if (!field) return;
    columnOrder.push(field);
    if (column.defaultVisible === false) {
      columnVisibilityModel[field] = false;
    }
  });

  return {
    columnVisibilityModel,
    columnOrder,
    sortModel: [],
    filterModel: {
      items: [],
      quickFilterValues: [],
    },
    pageSize: Math.max(5, Math.min(200, Math.floor(defaultPageSize || 25))),
    layoutMode: 'compact',
    textSize: 'md',
  };
}

function sanitizeState<Row extends SmartTableRow>(
  input: SmartTableViewState,
  columns: SmartTableColumnDef<Row>[],
  defaultPageSize: number
): SmartTableViewState {
  const defaults = createDefaultView(columns, defaultPageSize);
  const fields = new Set(columns.map((column) => String(column.field || '').trim()).filter(Boolean));

  const columnVisibilityModel: Record<string, boolean> = {
    ...defaults.columnVisibilityModel,
  };
  Object.entries(input.columnVisibilityModel || {}).forEach(([field, visible]) => {
    if (!fields.has(field)) return;
    columnVisibilityModel[field] = visible !== false;
  });

  const requestedOrder = Array.isArray(input.columnOrder) ? input.columnOrder : [];
  const sanitizedOrder = requestedOrder.filter((field) => fields.has(field));
  defaults.columnOrder.forEach((field) => {
    if (!sanitizedOrder.includes(field)) sanitizedOrder.push(field);
  });

  const sortModel = Array.isArray(input.sortModel)
    ? input.sortModel.filter((item) => fields.has(String(item?.field || '')))
    : [];

  const filterModel =
    input.filterModel && typeof input.filterModel === 'object'
      ? {
          ...defaults.filterModel,
          ...input.filterModel,
          items: Array.isArray(input.filterModel.items)
            ? input.filterModel.items.filter((item) => fields.has(String(item?.field || '')))
            : [],
        }
      : defaults.filterModel;

  const pageSize = Number.isFinite(Number(input.pageSize))
    ? Math.max(5, Math.min(200, Math.floor(Number(input.pageSize))))
    : defaults.pageSize;

  const layoutMode = input.layoutMode === 'expanded' ? 'expanded' : 'compact';
  const textSize = input.textSize === 'sm' || input.textSize === 'lg' ? input.textSize : 'md';

  return {
    columnVisibilityModel,
    columnOrder: sanitizedOrder,
    sortModel,
    filterModel,
    pageSize,
    layoutMode,
    textSize,
  };
}

function sanitizeSavedViews<Row extends SmartTableRow>(
  views: SmartTableSavedView[],
  columns: SmartTableColumnDef<Row>[],
  defaultPageSize: number
): SmartTableSavedView[] {
  const seen = new Set<string>();
  const next: SmartTableSavedView[] = [];
  views.forEach((view) => {
    const id = String(view?.id || '').trim();
    const name = String(view?.name || '').trim();
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    next.push({
      id,
      name: name.slice(0, 80),
      createdAt: String(view.createdAt || toIsoNow()),
      updatedAt: String(view.updatedAt || toIsoNow()),
      state: sanitizeState(view.state, columns, defaultPageSize),
    });
  });
  return next;
}

export function useSmartTableState<Row extends SmartTableRow>(
  options: UseSmartTableStateOptions<Row>
) {
  const { tableId, userId, columns, defaultPageSize = 25 } = options;

  const [viewState, setViewState] = useState<SmartTableViewState>(() =>
    createDefaultView(columns, defaultPageSize)
  );
  const [savedViews, setSavedViews] = useState<SmartTableSavedView[]>([]);

  useEffect(() => {
    const defaults = createDefaultView(columns, defaultPageSize);
    const persisted = loadSmartTableState(tableId, userId);
    if (!persisted) {
      setViewState(defaults);
      setSavedViews([]);
      return;
    }

    setViewState(sanitizeState(persisted.viewState, columns, defaultPageSize));
    setSavedViews(sanitizeSavedViews(persisted.savedViews || [], columns, defaultPageSize));
  }, [columns, defaultPageSize, tableId, userId]);

  useEffect(() => {
    const payload: SmartTablePersistedState = {
      version: SMART_TABLE_STORAGE_VERSION,
      viewState,
      savedViews,
    };
    saveSmartTableState(tableId, userId, payload);
  }, [savedViews, tableId, userId, viewState]);

  const orderedColumns = useMemo(() => {
    const byField = new Map<string, SmartTableColumnDef<Row>>();
    columns.forEach((column) => {
      const field = String(column.field || '').trim();
      if (!field) return;
      byField.set(field, column);
    });

    const ordered = viewState.columnOrder
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
  }, [columns, viewState.columnOrder]);

  const applyView = (input: ApplyViewInput) => {
    setViewState((current) =>
      sanitizeState(
        {
          columnVisibilityModel: input.columnVisibilityModel || current.columnVisibilityModel,
          columnOrder: input.columnOrder || current.columnOrder,
          sortModel: input.sortModel || current.sortModel,
          filterModel: input.filterModel || current.filterModel,
          pageSize: input.pageSize || current.pageSize,
          layoutMode: input.layoutMode || current.layoutMode,
          textSize: input.textSize || current.textSize,
        },
        columns,
        defaultPageSize
      )
    );
  };

  const resetView = () => {
    setViewState(createDefaultView(columns, defaultPageSize));
  };

  const saveCurrentView = (nameInput: string) => {
    const name = String(nameInput || '').trim().slice(0, 80);
    if (!name) return;

    setSavedViews((current) => {
      const existing = current.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        return current.map((entry) =>
          entry.id === existing.id
            ? {
                ...entry,
                updatedAt: toIsoNow(),
                state: viewState,
              }
            : entry
        );
      }

      return [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          createdAt: toIsoNow(),
          updatedAt: toIsoNow(),
          state: viewState,
        },
        ...current,
      ].slice(0, 24);
    });
  };

  const applySavedView = (viewId: string) => {
    const normalized = String(viewId || '').trim();
    if (!normalized) return;
    const target = savedViews.find((entry) => entry.id === normalized);
    if (!target) return;
    setViewState(sanitizeState(target.state, columns, defaultPageSize));
  };

  const deleteSavedView = (viewId: string) => {
    const normalized = String(viewId || '').trim();
    if (!normalized) return;
    setSavedViews((current) => current.filter((entry) => entry.id !== normalized));
  };

  return {
    viewState,
    savedViews,
    orderedColumns,
    setViewState,
    applyView,
    resetView,
    saveCurrentView,
    applySavedView,
    deleteSavedView,
  };
}
