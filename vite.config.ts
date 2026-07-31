import { fileURLToPath, URL } from "node:url";
import { defineConfig, type UserConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
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
