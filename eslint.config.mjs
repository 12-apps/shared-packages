import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReact from "eslint-plugin-react";
import globals from "globals";

/**
 * Root ESLint configuration for the monorepo
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  {
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
  },
  // Restrict @mui/material imports outside of packages/ui.
  // All MUI primitives must come from @repo/ui/mui (e.g. import { Box } from "@repo/ui/mui/Box").
  // packages/ui is excluded — it's where the MUI re-exports are defined.
  // @mui/icons-material/* remains allowed directly.
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["**/packages/ui/**", "packages/ui/**", "**/node_modules/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@mui/material", "@mui/material/*"],
              message:
                "Import MUI primitives from @repo/ui/mui instead (e.g. import { Box } from '@repo/ui/mui/Box'). For theme/styles use @repo/ui/mui/styles.",
            },
            {
              group: ["@mui/x-*", "@mui/x-*/*"],
              message:
                "MUI X imports are restricted. Use @repo/ui/data-display/DataGrid for new code.",
            },
          ],
        },
      ],
    },
  },
];
