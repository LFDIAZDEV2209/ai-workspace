#!/usr/bin/env node
/**
 * install.mjs — Instala el sistema ai-workspace en el workspace actual.
 *
 * Zero-dependency (solo node:fs / node:child_process). Idempotente: nunca
 * sobreescribe ficheros existentes del usuario.
 *
 * Uso:
 *   npx github:LFDIAZDEV2209/ai-workspace          # desde el proyecto a instrumentar
 *   node install.mjs                               # tras clonar el repo
 *   node install.mjs --codex --agy                 # también registra Codex/agy
 *   node install.mjs --no-mcp                      # solo scaffold, sin registro MCP
 */
import {
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const target = process.cwd();
const aiDir = path.join(target, ".ai");
const absBroker = path.join(aiDir, "broker", "broker.mjs");
const absBrokerUrl = absBroker.replace(/\\/g, "/");

function available(bin) {
  const r = spawnSync(bin, ["--version"], { shell: true });
  return r.status === 0;
}

function step(msg) {
  console.log(`· ${msg}`);
}

console.log(`\n🤖 ai-workspace — instalando en ${target}\n`);

// 1) Scaffold de .ai/ (idempotente, nunca pisa contenido del usuario)
if (existsSync(path.join(aiDir, "README.md"))) {
  step(".ai/ ya existe y es de este sistema — se reutiliza tal cual");
} else if (existsSync(aiDir)) {
  console.error(
    "❌ .ai/ ya existe pero no tiene README del sistema — revísalo manualmente antes de instalar",
  );
  process.exit(1);
} else {
  cpSync(path.join(REPO, "template"), aiDir, { recursive: true });
  step(".ai/ creado desde la plantilla");
}

// 2) Sembrar memoria (crea .ai/memory/memory.db con schema + FTS5)
try {
  execSync(`node "${absBroker}" seed`, { cwd: target, stdio: "pipe" });
  step("memory.db lista (SQLite + FTS5, zero deps)");
} catch {
  step("memory.db ya existía — seed omitido");
}

// 3) Registrar el MCP en los agentes disponibles
if (process.argv.includes("--no-mcp")) {
  step("--no-mcp: registro de agentes omitido");
} else {
  const brokerCmd = `node "${absBroker}"`;

  if (available("opencode")) {
    try {
      execSync(`opencode mcp add context-broker -- ${brokerCmd}`, {
        cwd: target,
        stdio: "pipe",
      });
      step("OpenCode: MCP registrado en el config del proyecto");
    } catch {
      step("OpenCode: ya estaba registrado (o fallo no bloqueante)");
    }
  } else {
    step(
      `opencode CLI no encontrado — registro manual cuando lo tengas:\n    opencode mcp add context-broker -- ${brokerCmd}`,
    );
  }

  // Codex: por defecto si existe ~/.codex (o con --codex explícito)
  const codexToml = path.join(os.homedir(), ".codex", "config.toml");
  if (process.argv.includes("--codex") || existsSync(codexToml)) {
    if (existsSync(codexToml)) {
      const txt = readFileSync(codexToml, "utf8");
      if (txt.includes("context-broker")) {
        step("Codex: ya registrado en ~/.codex/config.toml");
      } else {
        appendFileSync(
          codexToml,
          `\n[mcp_servers.context-broker]\ncommand = 'node'\nargs = ["${absBrokerUrl}"]\n`,
        );
        step("Codex: MCP añadido a ~/.codex/config.toml");
      }
    } else {
      step(
        "Codex: no hay ~/.codex/config.toml — omitido (usa --codex tras instalarlo)",
      );
    }
  }

  // agy (Antigravity CLI): solo con --agy explícito
  if (process.argv.includes("--agy") && available("agy")) {
    try {
      execSync(`agy mcp add context-broker -- ${brokerCmd}`, {
        cwd: target,
        stdio: "pipe",
      });
      step("agy: MCP registrado");
    } catch {
      step("agy: ya registrado o registro falló (no bloqueante)");
    }
  }
}

// 4) Verificación rápida del broker
try {
  const health = execSync(`node "${absBroker}" health`, {
    cwd: target,
    stdio: "pipe",
  }).toString();
  step(`broker: ${health.trim()}`);
} catch {
  console.error(
    "⚠️ broker no respondió al health — revisa docs/TROUBLESHOOTING.md",
  );
}

console.log(`
✅ Instalación lista.

SIGUIENTE PASO (obligatorio): pídele esto a tu agente (OpenCode/Codex/agy):

  «Lee .ai/playbooks/onboarding.md y rellena con datos reales de este workspace:
   .ai/workspace/PROJECTS.md, OVERVIEW.md, ROUTER.md y AGENT-MATRIX.md.
   Si ya tengo documentación dispersa, haz antes el inventario del caso 2 de
   docs/USE-CASES.md y consolida. No inventes nada: pregunta lo que falte.»

Docs: https://github.com/LFDIAZDEV2209/ai-workspace/tree/main/docs
`);
