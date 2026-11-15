import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/", "apps/web/dist/", "build/", "**/.wrangler/", "eval/private/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Spec section 7: raw console.* is banned outside the allowlisted logger.
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // The logger is the only Worker code allowed to write to the console.
    // CLI scripts print to the operator's own terminal by design.
    files: ["apps/worker/src/log/**", "scripts/**"],
    rules: { "no-console": "off" },
  },
  {
    // Plain-JS Node helpers (no TypeScript types to declare globals for them).
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", URL: "readonly" } },
  },
);
