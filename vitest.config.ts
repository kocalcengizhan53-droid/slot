import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Tests run inside workerd with the real bindings: a D1 database per test file with the
 * migrations applied, the rate limiters, the cron handler. An API test here is the API.
 *
 * Outbound requests never leave the machine: webhook deliveries reach a stand-in receiver
 * that accepts `receiver.example.com/ok` and fails everything else. The per-key API limit is
 * raised so one test tenant can run the file; the limiter itself is proven on the sandbox
 * door, which keeps its real limit.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
          ratelimits: {
            API_RATE: { namespace_id: "1001", simple: { limit: 10_000, period: 60 } },
            SANDBOX_RATE: { namespace_id: "1002", simple: { limit: 10, period: 60 } },
          },
          outboundService: (request: Request) => {
            const url = new URL(request.url);
            const ok = url.hostname === "receiver.example.com" && url.pathname === "/ok";
            return new Response(ok ? "ok" : "down", { status: ok ? 200 : 503 });
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      // One JSON line per request is noise in a passing run and evidence in a failing one.
      silent: "passed-only" as const,
    },
  };
});
