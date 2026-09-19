import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // Stamped onto every data request: GitHub Pages lets browsers cache each JSON file for ten
  // minutes on its own clock, so after a deploy a reader could get new figures in one file
  // and old ones in another. A new build asks for a new URL, so the set is always consistent.
  // Vite 8's defaults assume 2023+ browsers, and its CSS minifier then rewrites every
  // `max-width: 560px` into range syntax (`width<=560px`), which Safari before 16.4 ignores:
  // on an iPhone stuck on iOS 15 that silently disables the whole responsive layout. A news
  // audience includes those phones, so build for them.
  build: {
    target: ["es2020", "safari14", "chrome87", "firefox78", "edge88"],
    cssTarget: ["safari14", "chrome87", "firefox78", "edge88"],
  },
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
});
