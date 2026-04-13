import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronUp, ChevronDown, ChevronsUpDown, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface RowAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  searchKey?: string;
  searchPlaceholder?: string;
  onRowClick?: (row: TData) => void;
  emptyMessage?: string;
  toolbar?: ReactNode;
  /** Optional callback to add custom classes per row (e.g. unhealthy tinting). */
  getRowClassName?: (row: TData) => string;
  /** When true, rows get tabIndex=0 and arrow-key navigation between siblings. */
  keyboardNav?: boolean;
  /** Kebab menu actions per row. When provided, appends a three-dot actions column. */
  rowActions?: (row: TData) => RowAction[];
}

export function DataTable<TData>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "Search…",
  onRowClick,
  emptyMessage = "No results.",
  toolbar,
  getRowClassName,
  keyboardNav,
  rowActions,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // ── Kebab menu state — lifted here so cell re-renders can't destroy it ──
  const [kebabRowId, setKebabRowId] = useState<string | null>(null);
  const [kebabPos, setKebabPos] = useState({ top: 0, left: 0 });
  const [kebabActions, setKebabActions] = useState<RowAction[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const openKebab = useCallback((rowId: string, actions: RowAction[], btnEl: HTMLElement) => {
    const rect = btnEl.getBoundingClientRect();
    setKebabPos({ top: rect.bottom + 4, left: rect.right });
    setKebabActions(actions);
    setKebabRowId(rowId);
  }, []);

  const closeKebab = useCallback(() => setKebabRowId(null), []);

  // Close on outside click
  useEffect(() => {
    if (!kebabRowId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close if clicking the menu itself
      if (menuRef.current?.contains(target)) return;
      // Don't close if clicking a kebab button (it will toggle)
      if ((target as HTMLElement).closest?.("[data-kebab-btn]")) return;
      setKebabRowId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [kebabRowId]);

  // Close on Escape
  useEffect(() => {
    if (!kebabRowId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setKebabRowId(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [kebabRowId]);

  // Append kebab actions column when rowActions is provided
  const allColumns = useMemo(() => {
    if (!rowActions) return columns;
    const actionsCol: ColumnDef<TData, unknown> = {
      id: "_actions",
      header: "",
      size: 40,
      enableSorting: false,
      // Cell renders just the button — no local state needed
      cell: ({ row }) => {
        const actions = rowActions(row.original);
        if (actions.length === 0) return null;
        return (
          <div data-actions-cell>
            <button
              data-kebab-btn
              data-row-id={row.id}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                borderRadius: 4, padding: 4, color: "var(--c-text-primary, #e2e8f0)", background: "none", border: "none",
                cursor: "pointer",
              }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (kebabRowId === row.id) {
                  closeKebab();
                } else {
                  openKebab(row.id, actions, e.currentTarget);
                }
              }}
              aria-label="Row actions"
              aria-haspopup="menu"
            >
              <MoreVertical size={16} />
            </button>
          </div>
        );
      },
    };
    return [...columns, actionsCol];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, rowActions, kebabRowId]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: searchKey
      ? (row, _columnId, filterValue) => {
          const val = row.getValue(searchKey);
          return String(val ?? "").toLowerCase().includes(String(filterValue).toLowerCase());
        }
      : undefined,
  });

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar area */}
      <div className="flex items-center gap-2">
        {searchKey && (
          <Input
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="max-w-xs h-8 text-xs"
          />
        )}
        {toolbar}
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border bg-raised">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      "px-3 py-2 text-left text-xs font-medium text-muted-foreground",
                      header.column.getCanSort() && "cursor-pointer select-none hover:text-foreground"
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <span className="inline-flex">
                          {header.column.getIsSorted() === "asc" ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-30" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={allColumns.length}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={keyboardNav || onRowClick ? 0 : undefined}
                  role={onRowClick ? "button" : undefined}
                  className={cn(
                    "border-b border-border transition-colors hover:bg-raised/50",
                    onRowClick && "cursor-pointer",
                    getRowClassName?.(row.original)
                  )}
                  onClick={(e) => {
                    // Don't fire row click when clicking inside the actions column (kebab menu)
                    if ((e.target as HTMLElement).closest('[data-actions-cell]')) return;
                    onRowClick?.(row.original);
                  }}
                  onKeyDown={keyboardNav ? (e) => {
                    if (onRowClick && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault(); onRowClick(row.original);
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus?.();
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus?.();
                    }
                  } : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 text-foreground">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Row count */}
      <div className="text-xs text-muted-foreground">
        {table.getFilteredRowModel().rows.length} of {data.length} row(s)
      </div>

      {/* ── Kebab dropdown — rendered ONCE at DataTable level via portal ── */}
      {kebabRowId && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: "fixed",
            top: kebabPos.top,
            left: kebabPos.left,
            transform: "translateX(-100%)",
            zIndex: 99999,
            minWidth: 160,
            background: "var(--c-bg-surface, #1e293b)",
            border: "1px solid var(--c-border, #334155)",
            borderRadius: 8,
            padding: 4,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            animation: "fadeIn 100ms ease-out",
          }}
        >
          {kebabActions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              disabled={action.disabled}
              style={{
                display: "flex", width: "100%", alignItems: "center", gap: 8,
                borderRadius: 4, padding: "6px 8px", fontSize: 12,
                background: "none", border: "none", cursor: action.disabled ? "default" : "pointer",
                color: action.variant === "destructive" ? "#f87171" : "var(--c-text-primary, #e2e8f0)",
                opacity: action.disabled ? 0.5 : 1,
                transition: "background 100ms, color 100ms",
              }}
              onMouseEnter={(e) => {
                if (!action.disabled) {
                  e.currentTarget.style.background = action.variant === "destructive"
                    ? "rgba(239,68,68,0.1)" : "var(--c-bg-raised, #334155)";
                  e.currentTarget.style.color = action.variant === "destructive" ? "#f87171" : "var(--c-text-primary, #e2e8f0)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = action.variant === "destructive" ? "#f87171" : "#cbd5e1";
              }}
              onClick={(e) => {
                e.stopPropagation();
                setKebabRowId(null);
                action.onClick();
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
