import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AlertCard } from "./AlertCard";
import type { MonitorAlert } from "../types";

const BASE_ALERT: MonitorAlert & { ts: string; acknowledged?: boolean } = {
  type: "monitor_alert",
  level: "SEV1",
  reason: "CrashLoopBackOff",
  object: "pod/nginx",
  namespace: "default",
  source: "kubelet",
  message: "Container restarting",
  ts: "10:30:00",
};

describe("AlertCard", () => {
  it("renders alert reason and object", () => {
    render(<AlertCard alert={BASE_ALERT} />);
    expect(screen.getByText("CrashLoopBackOff")).toBeInTheDocument();
    expect(screen.getByText("pod/nginx")).toBeInTheDocument();
  });

  it("renders severity badge", () => {
    render(<AlertCard alert={BASE_ALERT} />);
    expect(screen.getByText("SEV1")).toBeInTheDocument();
  });

  it("renders timestamp", () => {
    render(<AlertCard alert={BASE_ALERT} />);
    expect(screen.getByText("10:30:00")).toBeInTheDocument();
  });

  it("renders message text", () => {
    render(<AlertCard alert={BASE_ALERT} />);
    expect(screen.getByText("Container restarting")).toBeInTheDocument();
  });

  it("renders source", () => {
    render(<AlertCard alert={BASE_ALERT} />);
    expect(screen.getByText("kubelet")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<AlertCard alert={BASE_ALERT} onClick={onClick} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows Ack button when onAck provided and not acknowledged", () => {
    const onAck = vi.fn();
    render(<AlertCard alert={BASE_ALERT} onAck={onAck} />);
    expect(screen.getByLabelText("Acknowledge alert")).toBeInTheDocument();
  });

  it("shows Acknowledged when already acknowledged", () => {
    const alert = { ...BASE_ALERT, acknowledged: true };
    render(<AlertCard alert={alert} onAck={() => {}} />);
    expect(screen.getByText("Acknowledged")).toBeInTheDocument();
    expect(screen.queryByLabelText("Acknowledge alert")).not.toBeInTheDocument();
  });

  it("calls onAck when Ack clicked without triggering onClick", () => {
    const onClick = vi.fn();
    const onAck = vi.fn();
    render(<AlertCard alert={BASE_ALERT} onClick={onClick} onAck={onAck} />);
    fireEvent.click(screen.getByLabelText("Acknowledge alert"));
    expect(onAck).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows AI hint when onClick provided", () => {
    render(<AlertCard alert={BASE_ALERT} onClick={() => {}} />);
    expect(screen.getByText("AI")).toBeInTheDocument();
  });
});
