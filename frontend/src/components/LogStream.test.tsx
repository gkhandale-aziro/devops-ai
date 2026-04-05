import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { LogStream } from "./LogStream";
import type { Target } from "../types";

// Minimal target fixture
const target: Target = { id: "t1", name: "local", type: "kubernetes" } as Target;

// Mock EventSource globally (jsdom doesn't implement it)
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen:   ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror:  ((ev: Event) => void) | null = null;
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  close() {}
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

// Mock the api module so logStreamUrl doesn't blow up
vi.mock("../api/client", () => ({
  api: { logStreamUrl: () => "/api/logs/t1/pod/default/stream" },
}));

describe("LogStream", () => {
  it("renders the pod name and namespace in the header", () => {
    render(
      <LogStream
        target={target}
        pod="frontend-7d9f"
        namespace="default"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("frontend-7d9f")).toBeInTheDocument();
    expect(screen.getByText("/ default")).toBeInTheDocument();
  });

  it("shows 'Connecting…' when EventSource is not yet open", () => {
    render(
      <LogStream target={target} pod="api-pod" namespace="prod" onClose={vi.fn()} />
    );
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
  });

  it("shows 'Waiting for logs…' after connection opens", () => {
    render(
      <LogStream target={target} pod="api-pod" namespace="prod" onClose={vi.fn()} />
    );
    const es = FakeEventSource.instances[0];
    act(() => { es.onopen?.(new Event("open")); });
    expect(screen.getByText("Waiting for logs…")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <LogStream target={target} pod="api-pod" namespace="prod" onClose={onClose} />
    );
    fireEvent.click(screen.getByLabelText("Close log stream"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clears lines when Clear button is clicked", () => {
    render(
      <LogStream target={target} pod="api-pod" namespace="prod" onClose={vi.fn()} />
    );
    const es = FakeEventSource.instances[0];
    act(() => { es.onopen?.(new Event("open")); });
    // Inject a log line
    act(() => { es.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ line: "info: started" }) })); });
    expect(screen.getByText("info: started")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.queryByText("info: started")).not.toBeInTheDocument();
  });

  it("renders the container name when provided", () => {
    render(
      <LogStream target={target} pod="api-pod" namespace="prod" container="sidecar" onClose={vi.fn()} />
    );
    expect(screen.getByText("(sidecar)")).toBeInTheDocument();
  });
});
