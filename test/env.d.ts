import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// `env` in cloudflare:test is Cloudflare.Env, the interface `wrangler types` generates; the
// test-only binding the vitest config injects is added here.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
