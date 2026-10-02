# 🧠 ai-workspace

<div align="center">

**Contexto, conocimiento y memoria con demanda progresiva para cualquier workspace de agentes IA.**

Tu OpenCode, Codex, agy o Claude Code dejan de re-leer 60 KB de docs obsoletas en cada sesión:
un Context Broker MCP les da exactamente el contexto que necesitan, cuando lo necesitan.

[![npm](https://img.shields.io/badge/install-npx%20github-CB3837?logo=npm&logoColor=white)](https://github.com/LFDIAZDEV2209/ai-workspace#-instalaci%C3%B3n-en-30-segundos)
[![node](https://img.shields.io/badge/node-%E2%89%A522.5-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![deps](<https://img.shields.io/badge/dependencies-0%20(zero%20dep)-success>)](template/broker/broker.mjs)
[![storage](https://img.shields.io/badge/SQLite%20%2B%20FTS5-WAL-003B57?logo=sqlite&logoColor=white)](template/memory/schema.sql)
[![agents](https://img.shields.io/badge/OpenCode%20·%20Codex%20·%20agy%20·%20Claude-verificado-blueviolet)](#-agentes-soportados)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

---

## El problema que resuelve

Cada agente nuevo (o cada sesión) recibe el mismo trato: **documentación duplicada, obsoleta,
dispersa** — `PLAN-FINAL-v3.md`, `CONTINUATION-2.md`, `AUDIT-5.md`, `HANDOFF-final-FINAL.md`…
El agente quema miles de tokens leyendo irrelevancia, olvida decisiones tomadas hace dos días
y repite errores ya resueltos.

**ai-workspace** convierte el workspace en un sistema autoorganizado de 5 niveles
(GLOBAL → WORKSPACE → PROJECT → FEATURE → SESSION) con **recuperación bajo demanda**:
el agente arranca con ~4 KB de reglas y pide el resto por tools del broker.

```
AGENTE: «¿qué repos toco para 'conectar programas del ERP con la app'?»
BROKER: get_dependencies → { repos: [back, front, app] }      ← 3 tokens de respuesta, no 60 KB de docs
AGENTE: read_doc("workspace/OVERVIEW.md")                      ← solo si necesita el estado
```

## ⚡ Instalación en 30 segundos

**Opción A — un comando** (desde la raíz de tu proyecto o workspace):

```bash
npx github:LFDIAZDEV2209/ai-workspace
```

**Opción B — con un prompt a tu agente** (él solo ejecuta todo):

```text
Lee https://github.com/LFDIAZDEV2209/ai-workspace/blob/main/AGENT-INSTALL.md
y ejecuta exactamente lo que indica.
```

**Qué hace el instalador** (idempotente, nunca pisa tus ficheros):

1. Crea `.ai/` en tu workspace desde la plantilla (broker, memoria, playbooks, gobernanza).
2. Siembra `memory.db` (SQLite + FTS5, zero deps — solo requiere Node ≥ 22.5).
3. Registra el MCP `context-broker` en OpenCode (y en Codex/agy con `--codex --agy`).
4. Verifica con un health check y te deja el prompt final para que tu agente
   rellene el contenido con los datos reales de tu proyecto.

```bash
# Flags
npx github:LFDIAZDEV2209/ai-workspace            # OpenCode + scaffold
npx github:LFDIAZDEV2209/ai-workspace --codex    # + Codex (config.toml)
npx github:LFDIAZDEV2209/ai-workspace --agy      # + agy (Antigravity CLI)
npx github:LFDIAZDEV2209/ai-workspace --no-mcp   # solo scaffold de .ai/
```

## 📦 Los 4 casos de uso

| Caso                                  | Situación                       | Qué hacer                                                            | Doc                                        |
| ------------------------------------- | ------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| **1. Proyecto sin documentación**     | Código en producción, cero docs | El agente te entrevista y construye los 4 canónicos                  | [USE-CASES.md · caso 1](docs/USE-CASES.md) |
| **2. Documentación desordenada**      | 20 PLAN/AUDIT/HANDOFF sueltos   | Inventario → consolidación → archive (sin borrar nada sin verificar) | [USE-CASES.md · caso 2](docs/USE-CASES.md) |
| **3. Workspace multi-repo**           | Varios repos relacionados       | PROJECTS + ROUTER: el agente sabe qué repos toca cada tarea          | [USE-CASES.md · caso 3](docs/USE-CASES.md) |
| **4. Equipo / instalación repetible** | Varios devs, varios PCs         | Plantilla global + anti-drift + `npx` en cada máquina                | [USE-CASES.md · caso 4](docs/USE-CASES.md) |

## 🔍 Cómo funciona (30 segundos)

```
~/.ai-workspace/global/  ← store GLOBAL de la máquina: knowledge cross-proyecto (todos los brokers lo leen)
.ai/
  broker/broker.mjs      ← Context Broker MCP (stdio, JSON-RPC 2.0, zero-dep node:sqlite)
  memory/memory.db       ← SQLite WAL + FTS5: lessons · decisions · incidents · patterns · handoffs
  workspace/             ← canónicos vivos (~5 KB c/u): OVERVIEW · PROJECTS · ROUTER · AGENT-MATRIX · OPEN-ITEMS
  knowledge/             ← texto canónico estructurado (1 fichero = 1 entrada, indexado por README)
  playbooks/             ← onboarding · QA · orquestación (Herdr) · release
  scripts/               ← session-close (learning pipeline) · doc-health (stale/duplicados/drift)
```

- **Arranque frío**: el agente lee ~4 KB de AGENTS.md y pide lo demás al broker (`workspace_overview`,
  `get_dependencies`, `search_knowledge`, `read_doc`… — 15 tools).
- **Aprendizaje entre proyectos**: una lesson/decisión con `scope: GLOBAL` se escribe en el
  store global de la máquina y aparece marcada `[global]` en las búsquedas de cualquier
  otro proyecto de ese PC — el agente del repo B aprende lo que el agente del repo A
  documentó. Demo real: una lesson nacida en un workspace fue encontrada por el broker
  de otro proyecto en otra ruta con su memoria local vacía.
- **Cierre de sesión**: `node .ai/scripts/session-close.mjs` registra el handoff y emite el checklist
  (OVERVIEW, OPEN-ITEMS, índices, commits).
- **Higiene continua**: `doc-health` detecta docs de sesión sueltas, canónicos >12 KB, stale >45 días,
  títulos duplicados, ficheros sin indexar y drift contra la plantilla global.

Arquitectura completa: **[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)**

## 🤖 Agentes soportados

| Agente                              | Registro                                     | Verificado                        |
| ----------------------------------- | -------------------------------------------- | --------------------------------- |
| **OpenCode** (incl. subagentes)     | `opencode.jsonc` → `mcp.servers`             | ✅ producción + cold-start        |
| **Codex**                           | `~/.codex/config.toml` → `[mcp_servers]`     | ✅ cold-start (GPT-6-Luna, 1m07s) |
| **agy / Antigravity CLI**           | `agy mcp add context-broker -- node …`       | ✅ cold-start (Gemini 3.8 Flash)  |
| **Claude Code**                     | lee `.ai/` vía `CLAUDE.md` pointer           | ✅ lectura (sin MCP)              |
| **Cualquier CLI que lea AGENTS.md** | el sistema vive en ficheros, no en un vendor | por diseño                        |

| **Prueba de fuego documentada**: agentes nuevos sin contexto previo respondieron

> 4/4 preguntas del workspace (repos, routing de tarea, comandos de build/test,
> bloqueos de TestFlight) usando únicamente este sistema — en 3 motores distintos.

## 🔧 Uso sin MCP (CLI directo)

```bash
node .ai/broker/broker.mjs overview            # resumen del workspace
node .ai/broker/broker.mjs router "<tarea>"    # ¿qué repos involucra?
node .ai/broker/broker.mjs search "<keywords>" # lessons/decisions/handoffs
node .ai/broker/broker.mjs health              # salud de la memoria
```

## 🩺 Troubleshooting

Los errores reales que sufrimos (y su solución) están en
**[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**: MCP "Request timed out"
(frames sin envelope JSON-RPC 2.0), warning experimental de `node:sqlite` (inofensivo,
va a stderr), mojibake en Windows (UTF-8 sin BOM + PS 5.1), concurrencia WAL multi-agente,
paths de Codex/agy.

## 📚 Docs

- [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) — arquitectura, niveles, broker, memoria, pipeline
- [docs/USE-CASES.md](docs/USE-CASES.md) — los 4 casos con prompts listos
- [docs/PROMPTS.md](docs/PROMPTS.md) — 10 prompts copia-pega para tu agente
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — fallos reales y solución
- [AGENT-INSTALL.md](AGENT-INSTALL.md) — el prompt de instalación para tu agente

## 🛣️ Roadmap

- [ ] `sqlite-vec` opcional (vector search) — el schema ya reserva la evolución
- [ ] Hooks de cierre de sesión automáticos por plugin
- [ ] `memory.mjs` CLI avanzado (stats, GC de sessions EPHEMERAL)
- [ ] Dashboard web del estado del workspace
- [ ] Publicación en npm registry (`npx ai-workspace` a secas)

---

<div align="center">

Hecho para que **cualquier agente sea inteligente desde el minuto uno**.
Si te sirvió, deja una ⭐.

</div>
