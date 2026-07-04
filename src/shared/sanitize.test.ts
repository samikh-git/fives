import { describe, expect, it } from "vitest";
import { sanitizeText } from "./sanitize";

describe("sanitizeText", () => {
  it("strips HTML tags", () => {
    expect(sanitizeText("<script>alert(1)</script>hello")).toBe("alert(1)hello");
    expect(sanitizeText("<b>bold</b> and <i>italic</i>")).toBe("bold and italic");
  });

  it("strips non-printable control characters", () => {
    expect(sanitizeText("hi" + "\x07" + "there" + "\x1B")).toBe("hithere");
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeText("gg, good luck!")).toBe("gg, good luck!");
  });

  it("does not strip newlines or tabs", () => {
    expect(sanitizeText("line one\nline two\ttabbed")).toBe("line one\nline two\ttabbed");
  });
});
