import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatModal } from "./ChatModal";
import type { ChatEntry } from "../../../src/shared/protocol";

const captainNames = { A: "Alex", B: "Bo" };

function makeMessages(): ChatEntry[] {
  return [
    { id: "1", captain: "A", text: "hello", ts: 1 },
    { id: "2", captain: "B", text: "hey back", ts: 2 },
  ];
}

describe("ChatModal", () => {
  it("starts closed, hiding the message list and form", () => {
    render(<ChatModal myCaptain="A" captainNames={captainNames} messages={makeMessages()} onSend={vi.fn()} />);

    expect(screen.queryByLabelText("Chat message")).not.toBeInTheDocument();
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
  });

  it("shows an unread badge for messages received while closed", () => {
    render(<ChatModal myCaptain="A" captainNames={captainNames} messages={makeMessages()} onSend={vi.fn()} />);

    expect(screen.getByLabelText("2 unread messages")).toBeInTheDocument();
  });

  it("opens to show messages and clears the unread badge", () => {
    render(<ChatModal myCaptain="A" captainNames={captainNames} messages={makeMessages()} onSend={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /toggle chat/i }));

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("hey back")).toBeInTheDocument();
    expect(screen.queryByLabelText(/unread messages/)).not.toBeInTheDocument();
  });

  it("keeps the message input present alongside a long message list", () => {
    const manyMessages: ChatEntry[] = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      captain: i % 2 === 0 ? "A" : "B",
      text: `message ${i}`,
      ts: i,
    }));
    render(<ChatModal myCaptain="A" captainNames={captainNames} messages={manyMessages} onSend={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /toggle chat/i }));

    expect(screen.getByLabelText("Chat message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("sends trimmed, non-empty text and clears the input", () => {
    const onSend = vi.fn();
    render(<ChatModal myCaptain="A" captainNames={captainNames} messages={[]} onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", { name: /toggle chat/i }));
    const input = screen.getByLabelText("Chat message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  gg  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("gg");
    expect(input.value).toBe("");
  });

  it("does not send a blank message", () => {
    const onSend = vi.fn();
    render(<ChatModal myCaptain="A" captainNames={captainNames} messages={[]} onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", { name: /toggle chat/i }));
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("closes when clicking the backdrop or the close button", () => {
    render(<ChatModal myCaptain="A" captainNames={captainNames} messages={[]} onSend={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /toggle chat/i }));
    expect(screen.getByLabelText("Chat message")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close chat" }));
    expect(screen.queryByLabelText("Chat message")).not.toBeInTheDocument();
  });
});
