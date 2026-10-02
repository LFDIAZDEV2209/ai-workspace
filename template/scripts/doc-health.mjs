#!/usr/bin/env node
/**
 * doc-health.mjs — Health check del sistema de documentación.
 * Detecta: docs de sesión (PLAN/AUDIT/HANDOFF/CONTINUATION) fuera de archive,
 * docs canónicos grandes (>10 KB), índices desactualizados y docs stale (>45 días sin tocar).
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const PATTERN_SESSION =
  /(PLAN|AUDIT|HANDOFF|CONTINUATION|INFORME|REPORTE|RESUMEN|REVIEW)/i;
// planes maestros canónicos y vivos (exentos del patrón de sesión)
const WHITELIST = new Set([
  "00-PLAN-MAESTRO.md",
  "erp-plan-2026-09.md",
  "roadmap.md",
]);
const EXCLUDE_DIRS =
  /node_modules|\.git|\.codegraph|bin|obj|\.venv|__pycache__|dist|\.next|\.agents[/\\]skills|\.opencode[/\\]skills|\.ai[/\\]archive|openspec[/\\]changes[/\\]archive/;
const NOW = Date.now();

const problems = {
  sessionFiles: [],
  tooBig: [],
  stale: [],
  dupTitles: [],
  unindexed: [],
  missingIndex: [],
};

function scan(dir, rel = "") {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const relPath = path.join(rel, e.name);
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.test(abs)) continue;
      scan(abs, relPath);
    } else if (e.name.endsWith(".md")) {
      // 1) docs de sesión fuera de archive (excluye planes canónicos whitelisted)
      if (
        PATTERN_SESSION.test(e.name) &&
        !WHITELIST.has(e.name) &&
        !relPath.includes("archive")
      )
        problems.sessionFiles.push(relPath);
      // 2) tamaño
      const size = statSync(abs).size;
      const isCanonico =
        relPath.startsWith(".ai") || /AGENTS\.md$/.test(e.name);
      if (isCanonico && size > 12 * 1024)
        problems.tooBig.push(`${relPath} [${Math.round(size / 1024)} KB]`);
      // 3) stale: .ai/knowledge + workspace sin tocar 45 días
      if (relPath.startsWith(".ai") && e.name !== "README.md") {
        const mtime = statSync(abs).mtime.getTime();
        if (NOW - mtime > 45 * 24 * 3600 * 1000)
          problems.stale.push(
            `${relPath} (${new Date(mtime).toISOString().slice(0, 10)})`,
          );
      }
    }
  }
}
// knowledge: títulos duplicados y ficheros sin indexar en el README de su tipo
function knowledgeChecks() {
  const base = path.join(ROOT, ".ai", "knowledge");
  if (!existsSync(base)) return;
  const titles = new Map();
  for (const dir of readdirSync(base, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(base, dir.name);
    for (const f of readdirSync(dirPath)) {
      if (!f.endsWith(".md") || f === "README.md") continue;
      const raw = readFileSync(path.join(dirPath, f), "utf8");
      const title = (
        raw.match(/^#\s+(?:[A-Z]\d+ — )?(.+)$/m)?.[1] ?? ""
      ).trim();
      const key = title.toLowerCase();
      if (key) {
        if (titles.has(key))
          problems.dupTitles.push(
            `"${title}" → ${titles.get(key)} ≡ ${dir.name}/${f}`,
          );
        else titles.set(key, `${dir.name}/${f}`);
      }
      const readme = path.join(dirPath, "README.md");
      if (existsSync(readme) && !readFileSync(readme, "utf8").includes(f))
        problems.unindexed.push(`${dir.name}/${f}`);
    }
  }
}

scan(ROOT);
knowledgeChecks();
console.log("## Health de documentación\n");
console.log(
  `- docs de sesión fuera de archive: ${problems.sessionFiles.length}`,
);
problems.sessionFiles.slice(0, 20).forEach((p) => console.log(`  · ${p}`));
console.log(`- canónicos >12 KB: ${problems.tooBig.length}`);
problems.tooBig.forEach((p) => console.log(`  · ${p}`));
console.log(`- .ai stale (>45 días): ${problems.stale.length}`);
problems.stale.slice(0, 15).forEach((p) => console.log(`  · ${p}`));
console.log(`- títulos duplicados en knowledge: ${problems.dupTitles.length}`);
problems.dupTitles.forEach((p) => console.log(`  · ${p}`));
console.log(`- knowledge sin indexar en README: ${problems.unindexed.length}`);
problems.unindexed.slice(0, 20).forEach((p) => console.log(`  · ${p}`));
// anti-drift: la copia runtime del broker debe coincidir con la plantilla global
function templateCheck() {
  const tplBroker = path.join(
    process.env.USERPROFILE ?? "",
    ".config",
    "opencode",
    "templates",
    "ai-workspace",
    "broker",
    "broker.mjs",
  );
  const wsBroker = path.join(ROOT, ".ai", "broker", "broker.mjs");
  if (existsSync(tplBroker) && existsSync(wsBroker)) {
    const a = readFileSync(tplBroker, "utf8");
    const b = readFileSync(wsBroker, "utf8");
    if (a !== b)
      return '⚠️ broker desfasado vs plantilla global — ejecuta: Copy-Item "$env:USERPROFILE\\.config\\opencode\\templates\\ai-workspace\\broker\\broker.mjs" .ai\\broker\\';
  }
  return null;
}

// anti-drift 2: variante de plataforma de impeccable (.agents vs .opencode) — drift conocido e
// intencional; el check vigila que el número de ficheros divergentes no crezca silenciosamente
function impeccableCheck() {
  const aDir = path.join(ROOT, ".agents", "skills", "impeccable");
  const oDir = path.join(ROOT, ".opencode", "skills", "impeccable");
  if (!existsSync(aDir) || !existsSync(oDir)) return null;
  const collect = (dir) => {
    const m = new Map();
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs);
        else m.set(path.relative(dir, abs).replace(/\\/g, "/"), true);
      }
    };
    walk(dir);
    return m;
  };
  const a = collect(aDir);
  const o = collect(oDir);
  const shared = [...a.keys()].filter((k) => o.has(k));
  let drift = 0;
  for (const k of shared) {
    try {
      if (
        !readFileSync(path.join(aDir, k)).equals(
          readFileSync(path.join(oDir, k)),
        )
      )
        drift++;
    } catch {
      drift++;
    }
  }
  if (drift)
    return `ℹ️ impeccable: ${drift}/${shared.length} ficheros comunes divergen entre .agents y .opencode (variantes de plataforma conocidas) — investigar solo si este número crece inesperadamente`;
  return null;
}

const readme = path.join(ROOT, ".ai", "README.md");
if (!existsSync(readme)) problems.missingIndex.push(".ai/README.md");
const drift = templateCheck();
if (drift) console.log(drift);
const imp = impeccableCheck();
if (imp) console.log(imp);
console.log(
  problems.missingIndex.length
    ? "\n❌ faltan índices: " + problems.missingIndex.join(", ")
    : "\n✅ índices OK",
);
