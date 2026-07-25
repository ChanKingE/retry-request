import { defineConfig, type UserConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
    minify: true,
  },
  lint: {
    ignorePatterns: ["**/*.test.ts"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["**/*.test.ts"],
  },
}) satisfies UserConfig;
