/**
 * Accessibility smoke tests — runs axe-core against key UI surfaces to
 * catch regressions in the a11y work from commit 2c7c139.
 *
 * Each test renders a component, runs the full axe ruleset, and asserts
 * zero violations. If axe finds issues, the failure message lists the
 * rule id, impact, and the HTML of the offending element.
 */
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ConfirmDialog } from "../components/confirm-dialog";
import { AlertCard } from "../components/AlertCard";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { DataTable } from "../components/ui/data-table";
import type { ColumnDef } from "@tanstack/react-table";

// Keep axe output on failure concise and relevant.
const axeOptions = {
  rules: {
    // jsdom doesn't render real colors, so contrast rule is noise here.
    "color-contrast": { enabled: false },
  },
};

describe("a11y: primitives", () => {
  it("Button has no violations", async () => {
    const { container } = render(
      <Button aria-label="Example action">Click me</Button>
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it("Input with associated label has no violations", async () => {
    const { container } = render(
      <div>
        <label htmlFor="email">Email</label>
        <Input id="email" type="email" placeholder="you@example.com" />
      </div>
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it("Badge has no violations", async () => {
    const { container } = render(<Badge>Running</Badge>);
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });
});

describe("a11y: ErrorBoundary fallback", () => {
  // Silence React's error boundary console.error output during the throw.
  const originalError = console.error;
  beforeAll(() => {
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("The above error")) return;
      originalError(...args);
    };
  });
  afterAll(() => { console.error = originalError; });

  it("fallback UI has no violations when a child throws", async () => {
    function Boom(): JSX.Element { throw new Error("Boom"); }
    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });
});

describe("a11y: ConfirmDialog", () => {
  it("open destructive dialog has no violations", async () => {
    const { baseElement } = render(
      <ConfirmDialog
        open={true}
        onOpenChange={() => {}}
        title="Remove connection?"
        description="Remove prod-k8s? This cannot be undone."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => {}}
      />
    );
    // Radix portals the dialog into document.body, so test against baseElement.
    expect(await axe(baseElement, axeOptions)).toHaveNoViolations();
  });
});

describe("a11y: AlertCard", () => {
  const baseAlert = {
    type:      "monitor_alert" as const,
    level:     "SEV1" as const,
    reason:    "CrashLoopBackOff",
    object:    "nginx-7b9f8c4d-xyz12",
    namespace: "default",
    message:   "Back-off restarting failed container",
    source:    "kubelet",
    ts:        "2026-04-12 01:30:00",
  };

  it("non-interactive card has no violations", async () => {
    const { container } = render(<AlertCard alert={baseAlert} />);
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it("interactive card (role=button) has no violations", async () => {
    const { container } = render(<AlertCard alert={baseAlert} onClick={() => {}} />);
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });
});

describe("a11y: DataTable", () => {
  interface Row { name: string; status: string; }
  const columns: ColumnDef<Row>[] = [
    { accessorKey: "name",   header: "Name" },
    { accessorKey: "status", header: "Status" },
  ];
  const data: Row[] = [
    { name: "nginx-1",  status: "Running" },
    { name: "nginx-2",  status: "Running" },
    { name: "coredns",  status: "Pending" },
  ];

  it("rendered table has no violations", async () => {
    const { container } = render(
      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
      />
    );
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });
});
