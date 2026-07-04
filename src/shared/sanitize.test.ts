import { describe, expect, it } from "vitest";
import { sanitizeChatText } from "./sanitize";

describe("sanitizeChatText", () => {
  it("strips HTML tags", () => {
    expect(sanitizeChatText("<script>alert(1)</script>hello")).toBe("alert(1)hello");
    expect(sanitizeChatText("<b>bold</b> and <i>italic</i>")).toBe("bold and italic");
  });

  it("strips non-printable control characters", () => {
    expect(sanitizeChatText("hi" + "\x07" + "there" + "\x1B")).toBe("hithere");
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeChatText("gg, good luck!")).toBe("gg, good luck!");
  });

  it("does not strip newlines or tabs", () => {
    expect(sanitizeChatText("line one\nline two\ttabbed")).toBe("line one\nline two\ttabbed");
  });
});
