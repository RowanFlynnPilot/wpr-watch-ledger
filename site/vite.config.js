import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // Stamped onto every data request: GitHub Pages lets browsers cache each JSON file for ten
  // minutes on its own clock, so after a deploy a reader could get new figures in one file
  // and old ones in another. A new build asks for a new URL, so the set is always consistent.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
});
