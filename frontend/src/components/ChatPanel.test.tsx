import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ChatPanel } from "./ChatPanel";
import { MAX_MESSAGE_CHARS } from "../hooks/useChat";

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
