#!/usr/bin/env node
/**
 * scaffold.mjs — Crea/actualiza un .ai/ en el workspace actual desde la plantilla global.
 *
 * Uso:  node "%USERPROFILE%\.config\opencode\templates\ai-workspace\scripts\scaffold.mjs"
 *       (o copiar esta carpeta a <workspace>/.ai/)
 *
 * Reglas:
 *   - NUNCA sobreescribe ficheros de contenido del workspace existentes (OVERVIEW, PROJECTS...).
 *   - Solo escribe lo que falta. Idempotente.
 *   - Los ficheros .template se copian sin el sufijo para que el agente los rellene.
 */
import {
  mkdirSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const target = process.cwd();
const aiDir = path.join(target, ".ai");

if (!existsSync(path.join(aiDir, "README.md")) && existsSync(aiDir)) {
  // .ai existe pero no es del sistema: no tocar sin permiso
  console.error(
    "❌ .ai/ ya existe y no tiene README del sistema — revisa manualmente",
  );
  process.exit(1);
}

mkdirSync(aiDir, { recursive: true });
let written = 0;

function copyTemplate(rel, dest) {
  const src = path.join(TEMPLATE_ROOT, rel);
  const dst = path.join(aiDir, dest ?? rel.replace(/\.template$/, ""));
  if (existsSync(dst)) return;
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  written++;
}

// tooling genérico (runtime copies)
copyTemplate("broker/broker.mjs");
copyTemplate("memory/schema.sql");
copyTemplate("scripts/doc-health.mjs");
copyTemplate("scripts/session-close.mjs");

// playbooks y knowledge genéricos
for (const f of readdirSync(path.join(TEMPLATE_ROOT, "playbooks")))
  copyTemplate(`playbooks/${f}`);
for (const d of ["decisions", "lessons", "incidents", "patterns"]) {
  copyTemplate(`knowledge/${d}/README.md`, `knowledge/${d}/README.md`);
}

// plantillas de contenido (con placeholders)
copyTemplate("workspace/OVERVIEW.md.template");
copyTemplate("workspace/PROJECTS.md.template");
copyTemplate("workspace/ROUTER.md.template");
copyTemplate("workspace/AGENT-MATRIX.md.template");
copyTemplate("workspace/OPEN-ITEMS.md.template");
copyTemplate("README.md");

console.log(`✅ .ai/ listo en ${target} (${written} ficheros creados)`);
if (written > 0) {
  console.log(`
SIGUIENTE PASO (obligatorio): rellena el contenido con el agente:
 1. .ai/workspace/PROJECTS.md   → lista de repos con puertos y comandos
 2. .ai/workspace/OVERVIEW.md   → estado por módulo con evidencia
 3. .ai/workspace/ROUTER.md     → keywords regex → repos
 4. .ai/workspace/AGENT-MATRIX.md → agentes disponibles y cuándo usarlos
 5. Registra la primera decisión: node .ai/broker/broker.mjs  (tool record_decision)
`);
}
