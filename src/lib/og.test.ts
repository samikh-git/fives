import { describe, expect, it } from "vitest";
import { injectOgMeta } from "./og";

const html = "<!doctype html><html><head><title>Fives</title></head><body></body></html>";

describe("injectOgMeta", () => {
  it("inserts og/twitter meta tags before </head>", () => {
    const result = injectOgMeta(html, {
      title: "Full-time",
      description: "See the squads",
      imageUrl: "https://example.com/img.png",
      url: "https://example.com/game/abc",
    });

    expect(result).toContain('<meta property="og:title" content="Full-time" />');
    expect(result).toContain('<meta property="og:description" content="See the squads" />');
    expect(result).toContain('<meta property="og:image" content="https://example.com/img.png" />');
    expect(result).toContain('<meta property="og:url" content="https://example.com/game/abc" />');
    expect(result).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(result.indexOf("og:title")).toBeLessThan(result.indexOf("</head>"));
  });

  it("escapes special characters in meta content to avoid breaking out of the attribute", () => {
    const result = injectOgMeta(html, {
      title: `A "quoted" <title>`,
      description: "Ben & Jerry's",
      imageUrl: "https://example.com/img.png",
      url: "https://example.com/game/abc",
    });

    expect(result).toContain("A &quot;quoted&quot; &lt;title&gt;");
    expect(result).toContain("Ben &amp; Jerry's");
  });
});
