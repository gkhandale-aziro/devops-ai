import { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from "react";
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

/** Per-row kebab menu — simple custom dropdown (no Radix Portal/DismissableLayer). */
function RowKebab<TData>({ row, rowActions }: { row: TData; rowActions: (row: TData) => RowAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const actions = rowActions(row);

  // Close on outside click
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleOutsideClick);
      return () => document.removeEventListener("mousedown", handleOutsideClick);
    }
  }, [open, handleOutsideClick]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div data-actions-cell ref={ref} style={{ position: "relative" }}>
      <button
        className="inline-flex items-center justify-center rounded-sm p-1 text-muted-foreground hover:bg-raised hover:text-foreground transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Row actions"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 min-w-[160px] overflow-hidden rounded-md border border-border bg-surface p-1 shadow-md"
          style={{ top: "100%", marginTop: 4, animation: "fadeIn 100ms ease-out" }}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              disabled={action.disabled}
              className={cn(
                "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors",
                "hover:bg-raised hover:text-foreground",
                action.disabled && "pointer-events-none opacity-50",
                action.variant === "destructive"
                  ? "text-red-400 hover:bg-red-500/10 hover:text-red-400"
                  : "text-muted-foreground",
              )}
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
        </div>
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
