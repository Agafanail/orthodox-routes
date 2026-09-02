import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".claude/**",
    ".playwright-cli/**",
    "out/**",
    "build/**",
    // Published from node_modules at build time, not written here.
    "public/maplibre/**",
    "next-env.d.ts",
  ]),
]);
