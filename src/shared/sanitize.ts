import striptags from "striptags";

/**
 * Strips HTML tags and non-printable control characters from user-supplied
 * chat text before it is stored/broadcast. Not an XSS defense by itself (React
 * already escapes text content) - this is about keeping stored/broadcast chat
 * history plain text, since a captain could otherwise paste markup or invisible
 * control characters into a message.
 */
export function sanitizeChatText(text: string): string {
  const withoutTags = striptags(text);
  return withoutTags.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
