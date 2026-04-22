import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { MAX_MESSAGE_CHARS, type ChatMsg } from "../hooks/useChat";

describe("ChatPanel — message length cap", () => {
  it("disables the send button when input exceeds MAX_MESSAGE_CHARS", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} loading={false} onSend={onSend} />);

    const textarea = screen.getByLabelText("Chat message");
    fireEvent.change(textarea, { target: { value: "x".repeat(MAX_MESSAGE_CHARS + 1) } });

    const sendBtn = screen.getByRole("button", { name: /send message/i });
    expect(sendBtn).toBeDisabled();
  });

  it("enables the send button at exactly MAX_MESSAGE_CHARS", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} loading={false} onSend={onSend} />);

    const textarea = screen.getByLabelText("Chat message");
    fireEvent.change(textarea, { target: { value: "x".repeat(MAX_MESSAGE_CHARS) } });

    const sendBtn = screen.getByRole("button", { name: /send message/i });
    expect(sendBtn).not.toBeDisabled();
  });

  it("shows an over-cap warning in the footer when text is too long", () => {
    render(<ChatPanel messages={[]} loading={false} onSend={vi.fn()} />);

    const textarea = screen.getByLabelText("Chat message");
    fireEvent.change(textarea, { target: { value: "x".repeat(MAX_MESSAGE_CHARS + 5) } });

    expect(screen.getByText(/too long/i)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`${MAX_MESSAGE_CHARS}`)),
    ).toBeInTheDocument();
  });

  it("does not call onSend when Enter is pressed on an over-cap message", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} loading={false} onSend={onSend} />);

    const textarea = screen.getByLabelText("Chat message");
    fireEvent.change(textarea, { target: { value: "x".repeat(MAX_MESSAGE_CHARS + 1) } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onSend with trimmed text for a normal-length message", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} loading={false} onSend={onSend} />);

    const textarea = screen.getByLabelText("Chat message");
    fireEvent.change(textarea, { target: { value: "  hello world  " } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("hello world");
  });
});

describe("ChatPanel — destructive command approval card", () => {
  // An assistant message carrying a pending approval is how useChat.ts
  // surfaces the await_approval SSE event to the UI. These tests prove
  // the card renders, the buttons fire onApproval with the right args,
  // and the terminal-state path (decision set) hides the buttons so the
  // operator can't double-approve.

  const pendingApproval: ChatMsg[] = [
    { role: "user", content: "clean up the broken pod" },
    {
      role: "assistant",
      content: "I can fix that for you.",
      approval: {
        approvalId: "abc123",
        cmd:        "kubectl delete pod demo-crashloop -n default",
      },
    },
  ];

  it("renders the approval card when an assistant message has a pending approval", () => {
    render(<ChatPanel messages={pendingApproval} loading={false} onSend={vi.fn()} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/destructive command/i)).toBeInTheDocument();
    expect(
      screen.getByText(/kubectl delete pod demo-crashloop/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve command/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny command/i })).toBeInTheDocument();
  });

  it("calls onApproval with 'approve' + approvalId when Approve is clicked", () => {
    const onApproval = vi.fn();
    render(
      <ChatPanel
        messages={pendingApproval}
        loading={false}
        onSend={vi.fn()}
        onApproval={onApproval}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve command/i }));
    expect(onApproval).toHaveBeenCalledWith("abc123", "approve");
  });

  it("calls onApproval with 'deny' when Deny is clicked", () => {
    const onApproval = vi.fn();
    render(
      <ChatPanel
        messages={pendingApproval}
        loading={false}
        onSend={vi.fn()}
        onApproval={onApproval}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /deny command/i }));
    expect(onApproval).toHaveBeenCalledWith("abc123", "deny");
  });

  it("disables both buttons after one is clicked (prevents double-posts)", () => {
    const onApproval = vi.fn();
    render(
      <ChatPanel
        messages={pendingApproval}
        loading={false}
        onSend={vi.fn()}
        onApproval={onApproval}
      />,
    );
    const approveBtn = screen.getByRole("button", { name: /approve command/i });
    const denyBtn    = screen.getByRole("button", { name: /deny command/i });
    fireEvent.click(approveBtn);
    expect(approveBtn).toBeDisabled();
    expect(denyBtn).toBeDisabled();
  });

  it("hides the buttons and shows a resolved banner once the decision event arrives", () => {
    // useChat.ts writes the terminal decision onto approval.decision when
    // approval_decision lands — the card should collapse to a status banner
    // and stop offering approve/deny so the operator can't re-trigger.
    const resolved: ChatMsg[] = [
      pendingApproval[0],
      {
        ...pendingApproval[1],
        approval: { ...pendingApproval[1].approval!, decision: "approved" },
      },
    ];
    render(<ChatPanel messages={resolved} loading={false} onSend={vi.fn()} />);
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve command/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /deny command/i })).toBeNull();
  });

  it("shows a timeout banner when the backend reports the approval timed out", () => {
    const timedOut: ChatMsg[] = [
      pendingApproval[0],
      {
        ...pendingApproval[1],
        approval: { ...pendingApproval[1].approval!, decision: "timeout" },
      },
    ];
    render(<ChatPanel messages={timedOut} loading={false} onSend={vi.fn()} />);
    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
  });
});
