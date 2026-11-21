#!/usr/bin/env node
/**
 * context-compact.mjs — compactación segura del contexto histórico.
 *
 * Política por defecto (configurable):
 *   - .ai/sessions/*.md        > 90 días  → .ai/archive/sessions/<año>/
 *   - .ai/operations/<dir>/    > 180 días → .ai/archive/operations/
 *   - .ai/knowledge/ (recursivo) > 180 días → solo se reporta (NUNCA se borra)
 *
 * Uso:
 *   node .ai/scripts/context-compact.mjs            # dry-run
 *   node .ai/scripts/context-compact.mjs --apply    # mueve sessions/operations
 *   node .ai/scripts/context-compact.mjs --days-knowledge 365 --apply
 */
import {
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const AI = path.join(ROOT, ".ai");
const ARCHIVE = path.join(AI, "archive");
const APPLY = process.argv.includes("--apply");

function argNum(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DAYS_SESSIONS = argNum("days-sessions", 90);
const DAYS_OPERATIONS = argNum("days-operations", 180);
const DAYS_KNOWLEDGE = argNum("days-knowledge", 180);
const NOW = Date.now();
const day = 24 * 3600 * 1000;

function ageDays(ms) {
  return Math.floor((NOW - ms) / day);
}

function moveTo(src, destDir) {
  if (!existsSync(src)) return null;
  mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(src));
  if (existsSync(dest)) return `existe: ${path.relative(ROOT, dest)}`;
  renameSync(src, dest);
  return path.relative(ROOT, dest).replace(/\\/g, "/");
}

const sessions = [];
const sessionsDir = path.join(AI, "sessions");
if (existsSync(sessionsDir)) {
  for (const f of readdirSync(sessionsDir)) {
    if (!f.endsWith(".md")) continue;
    const abs = path.join(sessionsDir, f);
    const st = statSync(abs);
    if (ageDays(st.mtimeMs) > DAYS_SESSIONS)
      sessions.push({
        name: f,
        abs,
        age: ageDays(st.mtimeMs),
        year: new Date(st.mtimeMs).getFullYear(),
      });
  }
}

const operations = [];
const operationsDir = path.join(AI, "operations");
if (existsSync(operationsDir)) {
  for (const d of readdirSync(operationsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const abs = path.join(operationsDir, d.name);
    const st = statSync(abs);
    if (ageDays(st.mtimeMs) > DAYS_OPERATIONS)
      operations.push({ name: d.name, abs, age: ageDays(st.mtimeMs) });
  }
}

const staleKnowledge = [];
function scanKnowledge(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      scanKnowledge(abs);
      continue;
    }
    if (!e.name.endsWith(".md") || e.name === "README.md") continue;
    const st = statSync(abs);
    if (ageDays(st.mtimeMs) > DAYS_KNOWLEDGE)
      staleKnowledge.push({
        path: path.relative(ROOT, abs).replace(/\\/g, "/"),
        age: ageDays(st.mtimeMs),
      });
  }
}
scanKnowledge(path.join(AI, "knowledge"));

console.log("## Compactación de contexto\n");
console.log(`- sesiones > ${DAYS_SESSIONS}d: ${sessions.length}`);
sessions.slice(0, 20).forEach((s) => console.log(`  · ${s.name} (${s.age}d)`));
console.log(`- operations > ${DAYS_OPERATIONS}d: ${operations.length}`);
operations
  .slice(0, 20)
  .forEach((o) => console.log(`  · ${o.name} (${o.age}d)`));
console.log(
  `- knowledge > ${DAYS_KNOWLEDGE}d (solo revisar): ${staleKnowledge.length}`,
);
staleKnowledge
  .slice(0, 20)
  .forEach((k) => console.log(`  · ${k.path} (${k.age}d)`));

if (APPLY) {
  console.log("\n## Aplicando\n");
  for (const s of sessions) {
    const dest = moveTo(s.abs, path.join(ARCHIVE, "sessions", String(s.year)));
    console.log(`session ${s.name} -> ${dest ?? "sin cambios"}`);
  }
  for (const o of operations) {
    const dest = moveTo(o.abs, path.join(ARCHIVE, "operations"));
    console.log(`operation ${o.name} -> ${dest ?? "sin cambios"}`);
  }
  console.log("\nKnowledge no se mueve ni se borra: requiere revisión humana.");
} else {
  console.log("\nDRY-RUN. Ejecuta con --apply para mover sessions/operations.");
}
