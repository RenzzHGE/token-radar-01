// Token Radar — entrypoint.
//
// Reads the sealed snapshot, ranks every rankable pre-token protocol by
// its implied launch value, and writes the run's outputs:
//
//   out/board.json    the ranked board, with each row's model arithmetic
//                     and its seven-step farm plan
//   out/data.js       the same data flattened for the dashboard page
//   out/dashboard/    a copy of the dashboard page
//   out/screenshots/  a copy of the screenshots
//   out/dossier.json  the evidence pack, written last
//
// Usage (from the repository root):
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Node 22 or newer, standard library only, no network.

import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRadar, MODEL_PARAMS, type Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function flagValue(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function flatRow(row: {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model: { base_multiple: number; chain_multiplier: number; growth_multiplier: number; maturity_multiplier: number };
}) {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    chain_multiplier: row.model.chain_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const input = flagValue(argv, "--input") ?? join(HERE, "..", "input", "snapshot.json");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? flagValue(argv, "--out") ?? join(HERE, "out");

  const snapshot = JSON.parse(readFileSync(resolve(input), "utf8")) as Snapshot;
  const result = buildRadar(snapshot, MODEL_PARAMS);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows: result.rows }));

  const payload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: result.params,
    model_version: "radar-2",
    watchlist_size: result.watchlist_size,
    board_size: result.rows.length,
    early_size: result.early_size,
    live_size: result.live.length,
    live_calibration_size: result.calibration.reduce((sum, c) => sum + c.n, 0),
    global_median: result.global_median,
    calibration: result.calibration,
    rows: result.rows.map(flatRow),
    live: result.live,
  };
  writeFileSync(join(outDir, "data.js"), `window.RADAR=${JSON.stringify(payload)};\n`);

  for (const file of ["index.html", "app.css", "app.js"]) {
    copyFileSync(join(HERE, "dashboard", file), join(outDir, "dashboard", file));
  }
  cpSync(join(HERE, "screenshots"), join(outDir, "screenshots"), { recursive: true });

  const dossier = buildDossier(join(outDir, "dashboard"), join(outDir, "screenshots"));
  writeFileSync(join(outDir, "dossier.json"), JSON.stringify(dossier));

  const liveCount = snapshot.protocols.filter((p) => p.mcap_usd !== null).length;
  console.log(`${snapshot.protocols.length} protocols, ${result.watchlist_size} watchlist, ${result.rows.length} rows`);
  console.log(
    `${result.early_size} early, ${result.live.length} live shown, ${payload.live_calibration_size} live calibrate, ` +
      `global median ${Number(result.global_median.toFixed(3))}, ${liveCount} live in snapshot`,
  );
  console.log(`top: ${result.rows[0].name} $${result.rows[0].implied_value_usd.toLocaleString("en-US")}`);
}

main();
