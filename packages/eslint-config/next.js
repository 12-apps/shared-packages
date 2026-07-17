import js from "@eslint/js";
import { globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReact from "eslint-plugin-react";
import globals from "globals";
import pluginNext from "@next/eslint-plugin-next";
import { config as baseConfig } from "./base.js";

/**
 * A custom ESLint configuration for libraries that use Next.js.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const nextJsConfig = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // React scope no longer necessary with new JSX transform.
      "react/react-in-jsx-scope": "off",
    },
  },
  // Restrict @mui/material imports in Next.js apps. All MUI primitives must be
  // imported from @12-apps/ui/mui (e.g. import { Box } from "@12-apps/ui/mui/Box");
  // only the @12-apps/ui package itself (react-internal config) may import
  // @mui/material directly. @mui/icons-material/* remains allowed.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@mui/material", "@mui/material/*"],
              message:
                "Import MUI primitives from @12-apps/ui/mui instead (e.g. import { Box } from '@12-apps/ui/mui/Box'). For theme/styles use @12-apps/ui/mui/styles.",
            },
            {
              group: ["@mui/x-*", "@mui/x-*/*"],
              message:
                "MUI X imports are restricted. Use @12-apps/ui/data-display/DataGrid for new code.",
            },
          ],
        },
      ],
    },
  },
];
