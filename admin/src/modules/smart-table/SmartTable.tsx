import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Paper,
} from '@mui/material';
import {
  DataGrid,
  type GridColumnOrderChangeParams,
  type GridFilterModel,
  type GridPaginationModel,
  type GridRowId,
  type GridRowSelectionModel,
  type GridRowParams,
  type GridSortModel,
} from '@mui/x-data-grid';
import ColumnManagerDialog from './components/ColumnManagerDialog';
import SavedViewsMenu from './components/SavedViewsMenu';
import SmartTableToolbar from './components/SmartTableToolbar';
import { useSmartTableState } from './hooks/useSmartTableState';
import { printSmartTableA4 } from './printA4';
import type {
  SmartTableColumnDef,
  SmartTableLiveState,
  SmartTablePrintOrientation,
  SmartTableRow,
} from './types';
import './SmartTable.css';

const MIN_RESIZABLE_COLUMN_WIDTH = 1;

interface SmartTableProps<Row extends SmartTableRow> {
  tableId: string;
  userId?: string;
  rows: Row[];
  columns: SmartTableColumnDef<Row>[];
  title?: string;
  loading?: boolean;
  error?: string;
  defaultPageSize?: number;
  pageSizeOptions?: number[];
  checkboxSelection?: boolean;
  selectionModel?: string[];
  onSelectionModelChange?: (ids: string[]) => void;
  onRowClick?: (row: Row) => void;
  getRowClassName?: (row: Row) => string;
  onRefresh?: () => Promise<void> | void;
  liveState?: SmartTableLiveState;
  lastEventAt?: string | null;
  lastSyncAt?: string | null;
  isRefreshing?: boolean;
  toolbarStartActions?: React.ReactNode;
  toolbarEndActions?: React.ReactNode;
  disableRowSelectionOnClick?: boolean;
}

function toSelectionModel(ids: string[] | undefined): GridRowSelectionModel {
  const normalized = new Set<GridRowId>();
  if (Array.isArray(ids)) {
    ids.forEach((id) => {
      normalized.add(String(id));
    });
  }
  return {
    type: 'include',
    ids: normalized,
  };
}

function fromSelectionModel(model: GridRowSelectionModel): string[] {
  if (Array.isArray(model)) {
    return model.map((entry) => String(entry));
  }
  const ids = model?.ids;
  if (!ids || typeof (ids as any).forEach !== 'function') return [];
  const result: string[] = [];
  (ids as Set<GridRowId>).forEach((entry) => {
    result.push(String(entry));
  });
  return result;
}

function toQuickSearchValue(filterModel: GridFilterModel): string {
  if (!Array.isArray(filterModel.quickFilterValues) || filterModel.quickFilterValues.length === 0) return '';
  return String(filterModel.quickFilterValues[0] || '').trim();
}

function normalizePrintableValue(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'string') return value.trim() || '–';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '–' : value.toLocaleString('de-DE');
  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => normalizePrintableValue(item))
      .filter((item) => item !== '–');
    return normalizedItems.length > 0 ? normalizedItems.join(', ') : '–';
  }
  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    const label = String(
      candidate.label ??
      candidate.name ??
      candidate.title ??
      candidate.value ??
      ''
    ).trim();
    if (label) return label;
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }
  return String(value);
}

function resolveColumnBaseValue<Row extends SmartTableRow>(row: Row, column: SmartTableColumnDef<Row>): unknown {
  const field = String(column.field || '').trim();
  const baseValue = field ? (row as Record<string, unknown>)[field] : undefined;
  if (typeof column.valueGetter !== 'function') return baseValue;
  const valueGetter = column.valueGetter as any;
  try {
    return valueGetter(baseValue, row, column, null);
  } catch (_error) {
    try {
      return valueGetter({
        id: row.id,
        field,
        row,
        value: baseValue,
        colDef: column,
        api: null,
      });
    } catch (_nestedError) {
      return baseValue;
    }
  }
}

function resolveColumnDisplayValue<Row extends SmartTableRow>(row: Row, column: SmartTableColumnDef<Row>): string {
  const field = String(column.field || '').trim();
  const baseValue = resolveColumnBaseValue(row, column);
  if (typeof column.valueFormatter !== 'function') {
    return normalizePrintableValue(baseValue);
  }
  const valueFormatter = column.valueFormatter as any;
  try {
    const formatted = valueFormatter(baseValue, row, column, null);
    return normalizePrintableValue(formatted);
  } catch (_error) {
    try {
      const formatted = valueFormatter({
        id: row.id,
        field,
        row,
        value: baseValue,
        colDef: column,
        api: null,
      });
      return normalizePrintableValue(formatted);
    } catch (_nestedError) {
      return normalizePrintableValue(baseValue);
    }
  }
}

function compareSortableValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }

  const aText = normalizePrintableValue(a).toLocaleLowerCase('de-DE');
  const bText = normalizePrintableValue(b).toLocaleLowerCase('de-DE');
  return aText.localeCompare(bText, 'de', { numeric: true, sensitivity: 'base' });
}

const SmartTable = <Row extends SmartTableRow>(props: SmartTableProps<Row>) => {
  const {
    tableId,
    userId,
    rows,
    columns,
    title,
    loading = false,
    error = '',
    defaultPageSize = 25,
    pageSizeOptions = [10, 25, 50, 100],
    checkboxSelection = false,
    selectionModel,
    onSelectionModelChange,
    onRowClick,
    getRowClassName,
    onRefresh,
    liveState,
    lastEventAt,
    lastSyncAt,
    isRefreshing = false,
    toolbarStartActions,
    toolbarEndActions,
    disableRowSelectionOnClick = true,
  } = props;

  const {
    viewState,
    setViewState,
    orderedColumns,
    savedViews,
    applyView,
    resetView,
    saveCurrentView,
    applySavedView,
    deleteSavedView,
  } = useSmartTableState<Row>({
    tableId,
    userId,
    columns,
    defaultPageSize,
  });

  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: viewState.pageSize,
  });
  const [printOrientation, setPrintOrientation] = useState<SmartTablePrintOrientation>('landscape');

  useEffect(() => {
    setPaginationModel((current) =>
      current.pageSize === viewState.pageSize
        ? current
        : {
            page: 0,
            pageSize: viewState.pageSize,
          }
    );
  }, [viewState.pageSize]);

  const quickSearch = useMemo(() => toQuickSearchValue(viewState.filterModel), [viewState.filterModel]);
  const gridSelectionModel = useMemo(
    () => toSelectionModel(selectionModel),
    [selectionModel]
  );
  const columnWidthScale = useMemo(() => {
    if (viewState.textSize === 'sm') return 0.93;
    if (viewState.textSize === 'lg') return 1.12;
    return 1;
  }, [viewState.textSize]);
  const scaledOrderedColumns = useMemo(
    () =>
      orderedColumns.map((column) => {
        const next = { ...column };
        const hasConfiguredMinWidth =
          typeof column.minWidth === 'number' && Number.isFinite(column.minWidth);
        const hasFlex = typeof column.flex === 'number' && Number.isFinite(column.flex);

        const scaledConfiguredMinWidth = hasConfiguredMinWidth
          ? Math.max(MIN_RESIZABLE_COLUMN_WIDTH, Math.round(Number(column.minWidth) * columnWidthScale))
          : undefined;
        if (typeof column.width === 'number') {
          next.width = Math.max(MIN_RESIZABLE_COLUMN_WIDTH, Math.round(column.width * columnWidthScale));
        } else if (scaledConfiguredMinWidth && !hasFlex) {
          // Preserve initial visual width for fixed columns while still allowing drag-to-collapse.
          next.width = scaledConfiguredMinWidth;
        }
        // Allow columns to be collapsed almost completely during manual resize.
        next.minWidth = MIN_RESIZABLE_COLUMN_WIDTH;
        if (typeof column.maxWidth === 'number') {
          next.maxWidth = Math.max(MIN_RESIZABLE_COLUMN_WIDTH, Math.round(column.maxWidth * columnWidthScale));
          if (typeof next.width === 'number') {
            next.width = Math.min(next.width, next.maxWidth);
          }
        }
        return next;
      }),
    [orderedColumns, columnWidthScale]
  );
  const visibleColumnsForPrint = useMemo(
    () =>
      orderedColumns.filter((column) => {
        const field = String(column.field || '').trim();
        if (!field) return false;
        if (field === 'actions') return false;
        if (column.type === 'actions') return false;
        if (viewState.columnVisibilityModel[field] === false) return false;
        return true;
      }),
    [orderedColumns, viewState.columnVisibilityModel]
  );
  const selectedIdSet = useMemo(() => {
    const set = new Set<string>();
    if (!Array.isArray(selectionModel)) return set;
    selectionModel.forEach((id) => {
      set.add(String(id));
    });
    return set;
  }, [selectionModel]);
  const rowsForPrint = useMemo(() => {
    const sortedAndFiltered = [...rows];
    const quickSearchNeedle = quickSearch.toLocaleLowerCase('de-DE');

    let filteredRows = sortedAndFiltered;
    if (quickSearchNeedle) {
      const terms = quickSearchNeedle.split(/\s+/).filter(Boolean);
      if (terms.length > 0) {
        filteredRows = sortedAndFiltered.filter((row) => {
          const haystack = visibleColumnsForPrint
            .map((column) => resolveColumnDisplayValue(row, column))
            .join(' ')
            .toLocaleLowerCase('de-DE');
          return terms.every((term) => haystack.includes(term));
        });
      }
    }

    const activeSorts = (viewState.sortModel || [])
      .map((sortEntry) => ({
        field: String(sortEntry.field || '').trim(),
        direction: sortEntry.sort === 'desc' ? 'desc' : sortEntry.sort === 'asc' ? 'asc' : null,
      }))
      .filter((sortEntry) => !!sortEntry.field && !!sortEntry.direction);
    if (activeSorts.length > 0) {
      const columnByField = new Map(
        orderedColumns
          .map((column) => [String(column.field || '').trim(), column] as const)
          .filter(([field]) => !!field)
      );
      filteredRows.sort((a, b) => {
        for (const sortEntry of activeSorts) {
          const column = columnByField.get(sortEntry.field);
          if (!column) continue;
          const aValue = resolveColumnBaseValue(a, column);
          const bValue = resolveColumnBaseValue(b, column);
          const compare = compareSortableValues(aValue, bValue);
          if (compare === 0) continue;
          return sortEntry.direction === 'desc' ? -compare : compare;
        }
        return 0;
      });
    }

    if (selectedIdSet.size > 0) {
      return filteredRows.filter((row) => selectedIdSet.has(String(row.id)));
    }
    return filteredRows;
  }, [quickSearch, orderedColumns, rows, selectedIdSet, viewState.sortModel, visibleColumnsForPrint]);
  const printSubtitle = useMemo(() => {
    const selectedSuffix = selectedIdSet.size > 0 ? ` (Auswahl: ${selectedIdSet.size})` : '';
    return `${rowsForPrint.length} Zeile(n)${selectedSuffix}`;
  }, [rowsForPrint.length, selectedIdSet.size]);
  const handlePrintA4 = () => {
    if (visibleColumnsForPrint.length === 0) return;
    const printableRows = rowsForPrint.map((row) => {
      const record: Record<string, string> = {};
      visibleColumnsForPrint.forEach((column) => {
        const field = String(column.field || '').trim();
        if (!field) return;
        record[field] = resolveColumnDisplayValue(row, column);
      });
      return record;
    });
    printSmartTableA4({
      title: title || 'Tabellenansicht',
      subtitle: printSubtitle,
      orientation: printOrientation,
      columns: visibleColumnsForPrint.map((column) => ({
        field: String(column.field || '').trim(),
        header: String(column.headerName || column.field || '').trim(),
        align: column.align === 'center' || column.align === 'right' ? column.align : 'left',
      })),
      rows: printableRows,
    });
  };
  const estimatedExpandedRowHeight = useMemo(() => {
    if (viewState.layoutMode !== 'expanded') return undefined;
    if (viewState.textSize === 'lg') return () => 126;
    if (viewState.textSize === 'sm') return () => 86;
    return () => 102;
  }, [viewState.layoutMode, viewState.textSize]);

  const handleSearchChange = (value: string) => {
    setViewState((current) => ({
      ...current,
      filterModel: {
        ...current.filterModel,
        quickFilterValues: value.trim() ? [value.trim()] : [],
      },
    }));
  };

  const handleSortModelChange = (sortModel: GridSortModel) => {
    setViewState((current) => ({
      ...current,
      sortModel,
    }));
  };

  const handleFilterModelChange = (filterModel: GridFilterModel) => {
    setViewState((current) => ({
      ...current,
      filterModel,
    }));
  };

  const handleColumnOrderChange = (params: GridColumnOrderChangeParams) => {
    const moved = String(params.field || '').trim();
    if (!moved) return;
    setViewState((current) => {
      const currentOrder = [...current.columnOrder];
      const without = currentOrder.filter((field) => field !== moved);
      without.splice(params.targetIndex, 0, moved);
      return {
        ...current,
        columnOrder: without,
      };
    });
  };

  return (
    <Paper
      variant="outlined"
      className={`smart-table-root smart-table-mode-${viewState.layoutMode} smart-table-text-${viewState.textSize}`}
    >
      <SmartTableToolbar
        title={title}
        totalCount={rows.length}
        search={quickSearch}
        onSearchChange={handleSearchChange}
        onRefresh={() => {
          void onRefresh?.();
        }}
        isRefreshing={isRefreshing}
        liveState={liveState}
        layoutMode={viewState.layoutMode}
        onLayoutModeChange={(layoutMode) => {
          setViewState((current) => ({
            ...current,
            layoutMode,
          }));
        }}
        textSize={viewState.textSize}
        onTextSizeChange={(textSize) => {
          setViewState((current) => ({
            ...current,
            textSize,
          }));
        }}
        lastEventAt={lastEventAt}
        lastSyncAt={lastSyncAt}
        onManageColumns={() => setColumnDialogOpen(true)}
        startActions={toolbarStartActions}
        endActions={toolbarEndActions}
        printOrientation={printOrientation}
        onPrintOrientationChange={setPrintOrientation}
        onPrint={handlePrintA4}
        printDisabled={visibleColumnsForPrint.length === 0 || rowsForPrint.length === 0}
        printTooltip={
          selectedIdSet.size > 0
            ? `Auswahl drucken (${rowsForPrint.length})`
            : `A4 drucken (${rowsForPrint.length})`
        }
        viewsMenu={
          <SavedViewsMenu
            savedViews={savedViews}
            onSaveCurrent={saveCurrentView}
            onApplyView={applySavedView}
            onDeleteView={deleteSavedView}
            onResetView={resetView}
          />
        }
      />

      {error && (
        <Box sx={{ px: 1.5, pt: 1.5 }}>
          <Alert severity="error">{error}</Alert>
        </Box>
      )}

      <Box className="smart-table-grid-wrap">
        <DataGrid
          rows={rows}
          columns={scaledOrderedColumns}
          loading={loading}
          disableRowSelectionOnClick={disableRowSelectionOnClick}
          checkboxSelection={checkboxSelection}
          rowSelectionModel={gridSelectionModel}
          onRowSelectionModelChange={(nextModel) => {
            onSelectionModelChange?.(fromSelectionModel(nextModel));
          }}
          onRowClick={(params: GridRowParams<Row>) => {
            onRowClick?.(params.row);
          }}
          getRowClassName={(params) => (getRowClassName ? getRowClassName(params.row as Row) : '')}
          columnVisibilityModel={viewState.columnVisibilityModel}
          onColumnVisibilityModelChange={(columnVisibilityModel) => {
            setViewState((current) => ({
              ...current,
              columnVisibilityModel,
            }));
          }}
          onColumnOrderChange={handleColumnOrderChange}
          sortingMode="client"
          sortModel={viewState.sortModel}
          onSortModelChange={handleSortModelChange}
          filterModel={viewState.filterModel}
          onFilterModelChange={handleFilterModelChange}
          density={viewState.layoutMode === 'compact' ? 'compact' : 'standard'}
          getRowHeight={viewState.layoutMode === 'expanded' ? () => 'auto' : undefined}
          getEstimatedRowHeight={estimatedExpandedRowHeight}
          pagination
          paginationMode="client"
          pageSizeOptions={pageSizeOptions}
          paginationModel={paginationModel}
          onPaginationModelChange={(nextModel) => {
            setPaginationModel(nextModel);
            if (nextModel.pageSize !== viewState.pageSize) {
              setViewState((current) => ({
                ...current,
                pageSize: nextModel.pageSize,
              }));
            }
          }}
          initialState={{
            pagination: {
              paginationModel: {
                page: 0,
                pageSize: viewState.pageSize,
              },
            },
          }}
          sx={{
            border: 'none',
            fontSize: 'var(--smart-grid-font-size)',
            '& .MuiDataGrid-columnHeaders': {
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--admin-surface-muted) 86%, #ffffff 14%) 0%, var(--admin-surface-muted) 100%)',
              borderBottom: '1px solid var(--admin-border)',
            },
            '& .MuiDataGrid-columnHeaderTitle': {
              fontSize: 'var(--smart-grid-header-font-size)',
              fontWeight: 700,
              lineHeight: 1.25,
            },
            '& .MuiDataGrid-cell': {
              alignItems: viewState.layoutMode === 'expanded' ? 'flex-start' : 'center',
              py: viewState.layoutMode === 'expanded' ? 0.9 : 0.2,
              overflow: viewState.layoutMode === 'expanded' ? 'visible' : 'hidden',
            },
            '& .MuiDataGrid-cellContent': {
              fontSize: 'var(--smart-grid-font-size)',
              whiteSpace: viewState.layoutMode === 'expanded' ? 'normal' : 'nowrap',
              lineHeight: viewState.layoutMode === 'expanded' ? 1.4 : 1.28,
              overflow: viewState.layoutMode === 'expanded' ? 'visible' : 'hidden',
              textOverflow: viewState.layoutMode === 'expanded' ? 'clip' : 'ellipsis',
              wordBreak: viewState.layoutMode === 'expanded' ? 'break-word' : 'normal',
              overflowWrap: viewState.layoutMode === 'expanded' ? 'anywhere' : 'normal',
            },
            '& .MuiDataGrid-cell:focus': {
              outline: 'none',
            },
            '& .MuiDataGrid-row:hover': {
              backgroundColor: 'rgba(0, 69, 124, 0.05)',
            },
            '& .MuiDataGrid-main': {
              overflowX: 'auto',
            },
            '& .MuiDataGrid-virtualScroller': {
              overflowX: 'auto',
            },
            '& .MuiDataGrid-columnHeader, & .MuiDataGrid-cell': {
              borderRight: '1px solid color-mix(in srgb, var(--admin-border) 82%, transparent 18%)',
            },
          }}
        />
      </Box>

      <ColumnManagerDialog
        open={columnDialogOpen}
        columns={orderedColumns}
        visibilityModel={viewState.columnVisibilityModel}
        columnOrder={viewState.columnOrder}
        onClose={() => setColumnDialogOpen(false)}
        onApply={(input) => {
          applyView({
            columnVisibilityModel: input.visibilityModel,
            columnOrder: input.columnOrder,
          });
        }}
      />
    </Paper>
  );
};

export default SmartTable;
