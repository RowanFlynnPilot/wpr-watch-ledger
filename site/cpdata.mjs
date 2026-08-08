import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/data", { recursive: true });
for (const f of ["cameras.json", "agencies.json", "meta.json", "history.json"]) {
  cpSync(`../data/${f}`, `public/data/${f}`);
}
