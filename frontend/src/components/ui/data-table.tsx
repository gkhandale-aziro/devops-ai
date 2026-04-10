import { useState, type ReactNode } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

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
}

export function DataTable<TData>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "Search...",
  onRowClick,
  emptyMessage = "No results.",
  toolbar,
  getRowClassName,
  keyboardNav,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
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
      <div className="rounded-md border border-border overflow-hidden">
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
                  colSpan={columns.length}
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
                  onClick={() => onRowClick?.(row.original)}
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
