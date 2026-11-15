// Dossier builder (makefun/dossier/v1).
//
// A dossier is the entry's own evidence pack: the dashboard files in full,
// so a reader can see exactly what the entry ships, plus the screenshots
// that show it running. It is built from the output directory after the
// run, so it always describes the files that were actually produced.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface DossierImage {
  name: string;
  media_type: string;
  base64: string;
  sha256: string;
}

export interface Dossier {
  schema: string;
  cover: number;
  images: DossierImage[];
  text: string;
}

const DASHBOARD_FILES: { name: string; language: string }[] = [
  { name: "app.css", language: "css" },
  { name: "app.js", language: "js" },
  { name: "index.html", language: "html" },
];

const SCREENSHOTS = ["01-board.png", "02-detail.png", "03-filtered.png"];

function countLines(text: string): number {
  const parts = text.split("\n");
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

function dashboardText(dashboardDir: string): string {
  const entries = DASHBOARD_FILES.map(({ name }) => {
    const path = join(dashboardDir, name);
    const bytes = statSync(path).size;
    return { name, bytes };
  });
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);

  let out = "## Dashboard\n\n";
  out += `Files: ${entries.length} (${totalBytes} bytes)\n`;
  for (const e of entries) {
    out += `- ${e.name} (${e.bytes} bytes)\n`;
  }
  out += "\n## Source\n";

  for (const { name, language } of DASHBOARD_FILES) {
    const path = join(dashboardDir, name);
    const content = readFileSync(path, "utf8");
    const bytes = statSync(path).size;
    out += `\n### ${name}\n\n${bytes} bytes, ${countLines(content)} lines\n\n`;
    out += `\`\`\`${language}\n${content}\`\`\`\n`;
  }
  return out;
}

function screenshotImages(screenshotsDir: string): DossierImage[] {
  return SCREENSHOTS.map((name) => {
    const raw = readFileSync(join(screenshotsDir, name));
    return {
      name,
      media_type: "image/png",
      base64: raw.toString("base64"),
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
  });
}

export function buildDossier(dashboardDir: string, screenshotsDir: string): Dossier {
  return {
    schema: "makefun/dossier/v1",
    cover: 0,
    images: screenshotImages(screenshotsDir),
    text: dashboardText(dashboardDir),
  };
}

export function listDashboardFiles(dashboardDir: string): string[] {
  return readdirSync(dashboardDir).filter((f) => f !== ".DS_Store").sort();
}
