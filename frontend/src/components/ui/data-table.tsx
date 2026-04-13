import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
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

/**
 * Per-row kebab menu — custom portal dropdown.
 * All inline styles to avoid any CSS class/variable resolution issues.
 */
function RowKebab<TData>({ row, rowActions }: { row: TData; rowActions: (row: TData) => RowAction[] }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const actions = rowActions(row);

  // Position menu relative to button when opening
  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.right });
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div data-actions-cell>
      <button
        ref={btnRef}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          borderRadius: 4, padding: 4, color: "#94a3b8", background: "none", border: "none",
          cursor: "pointer", transition: "color 150ms, background 150ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-bg-raised, #1e293b)"; e.currentTarget.style.color = "#e2e8f0"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#94a3b8"; }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label="Row actions"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreVertical size={16} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
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
          {actions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              disabled={action.disabled}
              style={{
                display: "flex", width: "100%", alignItems: "center", gap: 8,
                borderRadius: 4, padding: "6px 8px", fontSize: 12,
                background: "none", border: "none", cursor: action.disabled ? "default" : "pointer",
                color: action.variant === "destructive" ? "#f87171" : "#cbd5e1",
                opacity: action.disabled ? 0.5 : 1,
                transition: "background 100ms, color 100ms",
              }}
              onMouseEnter={(e) => {
                if (!action.disabled) {
                  e.currentTarget.style.background = action.variant === "destructive"
                    ? "rgba(239,68,68,0.1)" : "var(--c-bg-raised, #334155)";
                  e.currentTarget.style.color = action.variant === "destructive" ? "#f87171" : "#e2e8f0";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = action.variant === "destructive" ? "#f87171" : "#cbd5e1";
              }}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
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

  // Append kebab actions column when rowActions is provided
  const allColumns = useMemo(() => {
    if (!rowActions) return columns;
    const actionsCol: ColumnDef<TData, unknown> = {
      id: "_actions",
      header: "",
      size: 40,
      enableSorting: false,
      cell: ({ row }) => <RowKebab row={row.original} rowActions={rowActions} />,
    };
    return [...columns, actionsCol];
  }, [columns, rowActions]);

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
    </div>
  );
}
