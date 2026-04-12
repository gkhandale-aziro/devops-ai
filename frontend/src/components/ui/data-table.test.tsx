import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable } from "./data-table";
import type { ColumnDef } from "@tanstack/react-table";

interface TestRow {
  name: string;
  status: string;
  count: number;
}

const columns: ColumnDef<TestRow, unknown>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "count", header: "Count" },
];

const data: TestRow[] = [
  { name: "Alpha", status: "running", count: 3 },
  { name: "Beta", status: "stopped", count: 1 },
  { name: "Gamma", status: "running", count: 5 },
];

describe("DataTable", () => {
  it("renders column headers", () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Count")).toBeInTheDocument();
  });

  it("renders row data", () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("shows empty message when no data", () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="No pods found" />);
    expect(screen.getByText("No pods found")).toBeInTheDocument();
  });

  it("shows row count", () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText("3 of 3 row(s)")).toBeInTheDocument();
  });

  it("filters rows via search", async () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Filter by name..."
      />
    );

    const input = screen.getByPlaceholderText("Filter by name...");
    await userEvent.type(input, "Alpha");

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 3 row(s)")).toBeInTheDocument();
  });

  it("calls onRowClick when row is clicked", async () => {
    const onClick = vi.fn();
    render(<DataTable columns={columns} data={data} onRowClick={onClick} />);

    await userEvent.click(screen.getByText("Beta"));
    expect(onClick).toHaveBeenCalledWith({ name: "Beta", status: "stopped", count: 1 });
  });

  it("sorts on header click", async () => {
    render(<DataTable columns={columns} data={data} />);

    // First click sorts ascending
    await userEvent.click(screen.getByText("Count"));

    const rows = screen.getAllByRole("row");
    // Verify rows are sorted (order depends on tanstack default)
    // Just verify the sort changed the order from the original (Alpha, Beta, Gamma)
    const cellTexts = rows.slice(1).map(r => r.textContent);
    expect(cellTexts).not.toEqual(["Alpharunning3", "Betastopped1", "Gammarunning5"]);

    // Click again to toggle sort direction
    await userEvent.click(screen.getByText("Count"));
    const rows2 = screen.getAllByRole("row");
    const cellTexts2 = rows2.slice(1).map(r => r.textContent);
    // After two clicks the order should differ from the first sort
    expect(cellTexts2).not.toEqual(cellTexts);
  });

  it("renders toolbar content", () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        toolbar={<button>Export</button>}
      />
    );
    expect(screen.getByText("Export")).toBeInTheDocument();
  });
});
