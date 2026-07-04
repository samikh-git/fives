import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
export default defineWorkersConfig({
  test: {
    include: ["src/**/*.test.ts", "!src/shared/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        // The wrangler version vitest-pool-workers bundles internally predates
        // "ratelimits" config support, so wrangler.jsonc's binding gets silently
        // dropped when parsed for tests. Miniflare itself supports it, so wire the
        // same binding directly here to keep test env parity with the real Worker.
        miniflare: {
          ratelimits: {
            CREATE_GAME_RATE_LIMITER: { simple: { limit: 5, period: 60 } },
            VOTE_RATE_LIMITER: { simple: { limit: 10, period: 60 } },
            COMMENT_RATE_LIMITER: { simple: { limit: 10, period: 60 } },
          },
          bindings: {
            RESEND_API_KEY: "test-resend-key",
            RESEND_FROM_ADDRESS: "fives@example.com",
          },
        },
      },
    },
  },
});
