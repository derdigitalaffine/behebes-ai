import { useEffect, useMemo, useState } from 'react';

export interface SelectableRow {
  id: string;
}

export function useTableSelection<T extends SelectableRow>(allRows: T[]) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const availableIds = useMemo(() => new Set(allRows.map((row) => row.id)), [allRows]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => availableIds.has(id)));
  }, [availableIds]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const isSelected = (id: string) => selectedSet.has(id);

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  };

  const areAllSelected = (rows: T[]) => rows.length > 0 && rows.every((row) => selectedSet.has(row.id));

  const areSomeSelected = (rows: T[]) =>
    rows.some((row) => selectedSet.has(row.id)) && !areAllSelected(rows);

  const toggleAll = (rows: T[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldRemove = rows.length > 0 && rows.every((row) => next.has(row.id));

      if (shouldRemove) {
        rows.forEach((row) => next.delete(row.id));
      } else {
        rows.forEach((row) => next.add(row.id));
      }

      return Array.from(next);
    });
  };

  const clearSelection = () => setSelectedIds([]);

  const selectedRows = useMemo(
    () => allRows.filter((row) => selectedSet.has(row.id)),
    [allRows, selectedSet]
  );

  return {
    selectedIds,
    selectedSet,
    selectedRows,
    selectedCount: selectedIds.length,
    isSelected,
    toggleRow,
    toggleAll,
    areAllSelected,
    areSomeSelected,
    clearSelection,
    setSelectedIds,
  };
}

