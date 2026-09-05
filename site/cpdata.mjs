import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/data", { recursive: true });
for (const f of ["cameras.json", "agencies.json", "meta.json", "history.json", "edges.json", "wisdot_permits.json", "counties.json", "wi_counties.json"]) {
  cpSync(`../data/${f}`, `public/data/${f}`);
}
