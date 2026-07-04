import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { ChatCircleDots, X } from "@phosphor-icons/react";
import { useChatToggleSlot } from "../lib/chatToggleSlot";
import type { Captain } from "../../../src/shared/types";
import type { ChatEntry } from "../../../src/shared/protocol";

const MAX_CHAT_MESSAGE_LENGTH = 500;

export function ChatModal({
  myCaptain,
  captainNames,
  messages,
  onSend,
}: {
  myCaptain: Captain;
  captainNames: Record<Captain, string | null>;
  messages: ChatEntry[];
  onSend: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const seenCountRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const toggleSlot = useChatToggleSlot();

  useEffect(() => {
    if (!open) {
      setUnreadCount(messages.length - seenCountRef.current);
    } else {
      seenCountRef.current = messages.length;
      setUnreadCount(0);
    }
  }, [messages, open]);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  };

  const toggleButton = (
    <button
      type="button"
      className="chat-toggle"
      aria-expanded={open}
      aria-label="Toggle chat"
      onClick={() => setOpen((o) => !o)}
    >
      <ChatCircleDots size={22} weight={open ? "fill" : "regular"} />
      {unreadCount > 0 && (
        <span className="chat-toggle__badge" aria-label={`${unreadCount} unread messages`}>
          {unreadCount}
        </span>
      )}
    </button>
  );

  return (
    <>
      {toggleSlot ? createPortal(toggleButton, toggleSlot) : toggleButton}

      {open && (
        <div className="chat-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="chat-modal" onClick={(event) => event.stopPropagation()}>
            <div className="chat-modal__header">
              <span className="chat-modal__title">Chat</span>
              <button
                type="button"
                className="chat-modal__close"
                aria-label="Close chat"
                onClick={() => setOpen(false)}
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className="chat-modal__messages" ref={listRef}>
              {messages.length === 0 && <p className="chat-modal__empty">No messages yet</p>}
              {messages.map((entry) => (
                <div
                  key={entry.id}
                  className={`chat-bubble ${entry.captain === myCaptain ? "chat-bubble--mine" : "chat-bubble--theirs"}`}
                >
                  <span className="chat-bubble__author">
                    {captainNames[entry.captain] ?? `Captain ${entry.captain}`}
                  </span>
                  <span className="chat-bubble__text">{entry.text}</span>
                </div>
              ))}
            </div>

            <form className="chat-modal__form" onSubmit={handleSubmit}>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Message..."
                aria-label="Chat message"
                maxLength={MAX_CHAT_MESSAGE_LENGTH}
              />
              <button type="submit" className="btn btn--small" disabled={!draft.trim()}>
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
