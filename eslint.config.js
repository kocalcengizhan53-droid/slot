import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "dist", ".wrangler", "worker-configuration.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.serviceworker, ...globals.node } } },
  // The portal's browser scripts, served as they are from public/.
  { files: ["public/**/*.js"], languageOptions: { globals: globals.browser, sourceType: "module" } },
  // The quality gate runs in Node and hands callbacks to the browser through Playwright.
  { files: ["qa/**/*.mjs"], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
