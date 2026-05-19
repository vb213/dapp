import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "frontend", "js");
const names = ["DexToken", "NftCollection", "PawningHub"];
const out = {};

for (const name of names) {
  const path = join(root, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  out[name] = JSON.parse(readFileSync(path, "utf8")).abi;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "abis.json"), JSON.stringify(out));
console.log("Wrote frontend/js/abis.json");
