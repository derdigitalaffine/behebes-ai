import type {
  GridColDef,
  GridFilterModel,
  GridSortModel,
  GridValidRowModel,
} from '@mui/x-data-grid';
import type { AdminRealtimeTopic } from '../../lib/realtime';

export type SmartTableRow = GridValidRowModel & { id: string };

export type SmartTableColumnDef<Row extends SmartTableRow> = GridColDef<Row> & {
  defaultVisible?: boolean;
  lockVisibility?: boolean;
};

export type SmartTableLayoutMode = 'compact' | 'expanded';
export type SmartTableTextSize = 'sm' | 'md' | 'lg';
export type SmartTablePrintOrientation = 'portrait' | 'landscape';

export interface SmartTableViewState {
  columnVisibilityModel: Record<string, boolean>;
  columnOrder: string[];
  sortModel: GridSortModel;
  filterModel: GridFilterModel;
  pageSize: number;
  layoutMode: SmartTableLayoutMode;
  textSize: SmartTableTextSize;
}

export interface SmartTableSavedView {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  state: SmartTableViewState;
}

export interface SmartTablePersistedState {
  version: number;
  viewState: SmartTableViewState;
  savedViews: SmartTableSavedView[];
}

export interface SmartTableDataSourceResult<Row> {
  rows: Row[];
  total?: number;
}

export interface SmartTableDataSource<Row, Query> {
  defaultQuery: Query;
  fetchRows: (query: Query) => Promise<SmartTableDataSourceResult<Row>>;
}

export interface SmartTableLiveConfig<Query = unknown> {
  enabled: boolean;
  mode: 'sse' | 'poll' | 'hybrid';
  topics: AdminRealtimeTopic[];
  pollIntervalMsVisible: number;
  pollIntervalMsHidden: number;
  debounceMs: number;
  refetchOnFocus: boolean;
  staleAfterMs: number;
  query?: Query;
}

export type SmartTableLiveState = 'live' | 'reconnecting' | 'polling';

export const SMART_TABLE_STORAGE_VERSION = 1;
