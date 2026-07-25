declare module "vite-plugin-obfuscator" {
  import type { ObfuscatorOptions } from "javascript-obfuscator";
  import type { Plugin } from "vite-plus";

  export function viteObfuscateFile(options?: ObfuscatorOptions): Plugin;
}
