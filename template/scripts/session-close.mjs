#!/usr/bin/env node
/**
 * session-close.mjs — Learning Pipeline de fin de sesión.
 *
 * Flujo: el agente (o el usuario) invoca tras terminar trabajo:
 *   node .ai/scripts/session-close.mjs --summary "..." --agent opencode \
 *        --repos "<repo1,repo2>" --commits "<sha1,sha2>" \
 *        [--lesson "titulo|cuerpo"] [--decision "titulo|cuerpo"] [--incident "titulo|cuerpo"] \
 *        [--interactive]
 *
 * Hace:
 *   1. registra handoff en memoria (scope SESSION)
 *   2. registra lessons/decisions/incidents si se pasan (--lesson etc.)
 *   3. escribe .ai/sessions/<fecha>-<agente>.md con el handoff (resumen legible)
 *   4. imprime checklist de lo que el agente DEBE hacer a mano antes de cerrar:
 *      OVERVIEW.md / OPEN-ITEMS.md / commits push
 *
 * Modo --interactive: pregunta con process.stdin (para uso manual fuera de agentes).
 */
import { spawn } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const BROKER = path.join(ROOT, ".ai", "broker", "broker.mjs");

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--"))
    return process.argv[i + 1];
  if (i >= 0) return true; // flag sin valor
  return fallback;
}

function callBroker(tool, args) {
  return new Promise((resolve) => {
    const proc = spawn("node", [BROKER], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (c) => (out += c));
    const send = (id, method, params) =>
      proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    send(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {} });
    send(2, "tools/call", { name: tool, arguments: args });
    setTimeout(() => {
      try {
        const lines = out.trim().split("\n").filter(Boolean);
        const resp = lines
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .find((m) => m.id === 2);
        resolve(resp?.result?.content?.[0]?.text ?? "sin respuesta");
      } finally {
        proc.kill();
      }
    }, 1200);
  });
}

const summary = arg("summary");
if (!summary) {
  console.log(
    `Uso: node .ai/scripts/session-close.mjs --summary "qué se hizo" --agent opencode --repos "a,b" [--lesson "t|c"] [--decision "t|c"] [--incident "t|c"]`,
  );
  process.exit(1);
}

const agent = arg("agent", "opencode");
const repos = arg("repos", "workspace");
const commits = arg("commits", "");
const now = new Date();

console.log("→ registrando handoff…");
const handoffMsg = await callBroker("session_handoff", {
  title: `${now.toISOString().slice(0, 10)} sesión ${agent}`,
  body: summary,
  repo: repos,
  scope: "SESSION",
  tags: "sesion",
});

// lessons/decisions/incidents: --lesson "titulo|cuerpo" (repetibles)
for (const [flag, type, tool] of [
  ["lesson", "lesson", "record_lesson"],
  ["decision", "decision", "record_decision"],
  ["incident", "incident", "record_incident"],
]) {
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] !== `--${flag}`) continue;
    const v = process.argv[i + 1];
    if (!v || v.startsWith("--")) continue;
    const [t, c] = v.split("|");
    console.log(`→ registrando ${type}: ${t}`);
    await callBroker(tool, {
      title: t,
      body: c ?? "",
      repo: repos,
      scope: "PROJECT",
      source: `sesión ${agent} ${now.toISOString().slice(0, 10)}`,
    });
  }
}

// fichero de handoff legible
const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, "");
const file = path.join(ROOT, ".ai", "sessions", `${stamp}-${agent}.md`);
writeFileSync(
  file,
  [
    `# Sesión ${stamp} — ${agent}`,
    "",
    `**Repos:** ${repos}  ·  **Commits:** ${commits || "sin push/commit registrado"}`,
    "",
    summary,
    "",
    handoffMsg,
  ].join("\n"),
  "utf8",
);

console.log(`✅ handoff en memoria + ${path.relative(ROOT, file)}`);
console.log(`
CHECKLIST MANUAL DEL AGENTE (no omitir):
 [ ] ¿Cambió el estado de algún módulo? → actualizar .ai/workspace/OVERVIEW.md (tabla Estado por módulo)
 [ ] ¿Quedan tareas abiertas? → .ai/workspace/OPEN-ITEMS.md
 [ ] ¿Decisiones con fichero en .ai/knowledge/decisions/ e índice?
 [ ] ¿Commits push a la rama correcta? git status limpio
 [ ] ¿Panels Herdr cerrados o documentados?
 [ ] ¿Docs del repo (docs/modules/<mod>/) necesitan actualización?
`);
