import { createContext, useContext } from "react";

/**
 * DOM node inside the header actions bar that the chat toggle button portals
 * into. Null outside of AppShell (e.g. component tests rendered in
 * isolation), in which case consumers fall back to rendering inline.
 */
export const ChatToggleSlotContext = createContext<HTMLElement | null>(null);

export function useChatToggleSlot(): HTMLElement | null {
  return useContext(ChatToggleSlotContext);
}
