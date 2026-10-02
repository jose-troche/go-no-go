import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".wrangler", "node_modules", "worker-configuration.d.ts"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // this.sql`...` statements are tagged templates executed for their side effect.
      "@typescript-eslint/no-unused-expressions": ["error", { allowTaggedTemplates: true }],
    },
  },
  {
    // Boundary rule (implementation guide 5): thresholds, scenario scripts, and agents stay server-only.
    files: ["src/client/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/server/**", "**/server"], message: "The client must not import server code (sim engine, stations, policy)." },
          ],
        },
      ],
    },
  },
);
