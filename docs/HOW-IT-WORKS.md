# Cómo funciona ai-workspace

> Sistema de contexto, conocimiento y memoria con **recuperación bajo demanda**.
> Principio rector: **reducir el contexto del agente, no aumentarlo.**

## 1. La jerarquía de 5 niveles

```
GLOBAL      reglas y skills reutilizables para CUALQUIER proyecto
            (~/.config/opencode/AGENTS.md · agents/ · skills/ · templates/ai-workspace/)
   ↓
WORKSPACE   arquitectura y conocimiento del ecosistema completo
            (.ai/workspace/*.md · .ai/knowledge/ · .ai/memory/memory.db)
   ↓
PROJECT     contexto específico de cada repo
            (<repo>/AGENTS.md · <repo>/docs/modules/<mod>/README.md)
   ↓
FEATURE     OpenSpec + decisiones solo cuando la tarea lo requiere
            (openspec/changes/<feature>/ · ADRs)
   ↓
SESSION     temporal; se consolida o se elimina al cerrar
            (.ai/sessions/ → compactar a 90 días · handoffs → memory.db)
```

**Qué se carga SIEMPRE**: solo el `AGENTS.md` raíz (~4 KB: mapa del sistema + reglas invariables).
**Todo lo demás es on-demand** vía el broker.

## 2. El Context Broker (MCP stdio)

`template/broker/broker.mjs` — un único fichero **zero-dependency** (solo `node:sqlite`,
incluido desde Node 22.5) que habla **JSON-RPC 2.0 sobre stdio, delimitado por newlines**
(NDJSON), el transporte estándar MCP.

**17 tools**:

| Tool                                                    | Qué hace                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `workspace_overview`                                    | Resumen mínimo; preámbulo + 3 secciones capadas (~7 KB)              |
| `context_brief`                                         | Router + docs + knowledge + open items en UNA llamada (~5 KB)        |
| `project_context`                                       | Contexto de un repo: secciones de su AGENTS.md + memoria relacionada |
| `search_knowledge`                                      | Búsqueda híbrida: FTS de memoria + escaneo vivo de `.ai/knowledge/`  |
| `search_docs`                                           | FTS5/BM25 sobre docs/, openspec/, `<repo>/docs/` y specs OpenAPI     |
| `get_current_state` / `get_open_tasks`                  | OVERVIEW/OPEN-ITEMS con cap (24 KB / 8 KB; offset para el resto)     |
| `get_decisions` / `get_lessons` / `get_incidents`       | Índices con ruta del fichero canónico                                |
| `get_dependencies`                                      | **Router**: texto de tarea → repos involucrados (tabla de ROUTER.md) |
| `read_doc`                                              | Lee md/mdx/txt/json/yaml bajo allowlist; cap 12 KB + `offset`        |
| `record_decision` / `record_lesson` / `record_incident` | Escritura al log de memoria + fichero canónico + índice README       |
| `session_handoff`                                       | Handoff de cierre de sesión                                          |
| `memory_health`                                         | Salud: entradas, WAL, stale                                          |

### Por qué SQLite + FTS5 (y no embeddings, de momento)

- **Cero dependencias**: `node:sqlite` viene en Node; sin pip/npm/additional services.
- **FTS5 con triggers**: el índice se mantiene solo en cada INSERT/UPDATE/DELETE.
- **Metadata explícita**: `project`, `repo`, `type`, `scope`, `status`, `created_at`,
  `updated_at`, `source`, `commit_sha`, `confidence`, `supersedes`, `tags` — la memoria
  es consultable y auditable, no una caja negra.
- **El camino a vectores está abierto**: el schema es aditivo; añadir `sqlite-vec`
  después no rompe nada, pero nunca es obligatorio.

### El escaneo híbrido (anti-staleness)

`search_knowledge` busca en TRES fuentes y fusiona por ranking:

1. **memory.db local (FTS5)** — lo registrado en ESTE workspace.
2. **Store global de la máquina (`~/.ai-workspace/global/memory.db`)** — conocimiento
   `scope: GLOBAL` de CUALQUIER proyecto de este PC; los hits salen marcados `[global]`.
   Ahí van las lecciones generales (mcp/windows/tooling): el agente del repo B aprende
   lo que el agente del repo A documentó, sin compartir memoria sensible del proyecto.
3. **Escaneo vivo de `.ai/knowledge/**/*.md`** — score por presencia del término en
   nombre de fichero y contenido. **Siempre fresco**: si un agente edita el fichero
   hace 3 segundos, la búsqueda lo ve (la memoria es solo el índice; **el código y los
   docs mandan**).

> Sobre **vector search**: queda reservado (el schema es aditivo) pero no se añade de
> fábrica — para recuperar notas por keywords, FTS5 gana a coste cero y sin dependencias;
> `sqlite-vec` se integra después solo si el volumen o las consultas semánticas lo justifican.

### El índice de documentación (`search_docs`)

`context_brief` y `search_docs` comparten un índice FTS5 **en memoria** que se construye
lazy (primera llamada) y se reconstruye cada 10 minutos:

- Indexa Markdown de `docs/`, `openspec/`, `<repo>/docs/`, `.ai/workspace/` y
  `.ai/operations/`; incluye specs `.json/.yaml` cuyo path contenga `openapi/swagger/contract`.
- Excluye `node_modules`, `.worktrees`, `.git`, `archive`, `dist`, `build`, `bin`, `obj`,
  `.next` y `.venv`; no sigue symlinks (evita bucles y fugas).
- Deduplica copias idénticas por SHA-1 (p. ej. docs replicados en varios repos).
- Ranking BM25 con **peso de path (4×), título (5×) y body (1×)**, prefijos para términos
  ≥4 letras y sinónimos de dominio (`contrato` → `contract/openapi/swagger`).
- Devuelve `path + fecha + título + snippet`; nunca el archivo completo. El detalle se pide
  con `read_doc(file, limit, offset)`.
- En CoppAddresd indexa ~495 docs activos (no 20k: los README de `node_modules` no cuentan).

## 3. El pipeline de aprendizaje (fin de sesión)

```
sesión → node .ai/scripts/session-close.mjs --summary "..." --agent <agente> --repos "<r>"
       → 1. handoff registrado en memoria (scope SESSION)
       → 2. fichero legible en .ai/sessions/<fecha>-<agente>.md
       → 3. checklist emitido al agente:
            [ ] OVERVIEW.md actualizado si cambió el estado de un módulo
            [ ] OPEN-ITEMS.md con tareas nuevas/cerradas
            [ ] ficheros de knowledge/ creados + indexados en su README
            [ ] commits push, git status limpio
            [ ] panes de Herdr cerrados o documentados
```

**Clasificación de conocimiento** (impide que lo temporal contamine lo permanente):

| Scope       | Vive en                                                                  | Purga         |
| ----------- | ------------------------------------------------------------------------ | ------------- |
| `EPHEMERAL` | notas sueltas, capturas, .bak                                            | tras la tarea |
| `SESSION`   | `.ai/sessions/` + handoffs en memoria                                    | 90 días       |
| `PROJECT`   | `docs/` del repo o knowledge del repo                                    | permanente    |
| `WORKSPACE` | `.ai/knowledge/` + `.ai/workspace/`                                      | permanente    |
| `GLOBAL`    | store global `~/.ai-workspace/global/` + reglas en `~/.config/opencode/` | permanente    |

## 4. Gobernanza (las reglas que evitan el monstruo)

1. **Un fichero = un tema.** Prohibidos `PLAN-FINAL-X`, `CONTINUATION-X`, `AUDIT-X`, `HANDOFF-X` sueltos.
2. **Canónicos pequeños**: OVERVIEW/PROJECTS/ROUTER/AGENT-MATRIX/OPEN-ITEMS ≤ ~10 KB c/u;
   si crecen, los tools los capan y el detalle se pide con `offset`.
3. **Progressive disclosure**: `workspace_overview` → `context_brief` → `search_docs` →
   `read_doc` (2-3); presupuesto ≤6 llamadas / ≤8k tokens antes de la primera hipótesis.
4. **El código manda**: memoria desactualizada pierde contra el código; al detectarlo se corrige la memoria.
5. **No indexar a ciegas**: la memoria se alimenta por `record_*` explícitos y el pipeline de cierre.
6. **Sin secretos jamás** en `.ai/` (ni keys ni contraseñas).

## 4.1 Compactación, evaluación y salud del PC

- **`context-compact.mjs`**: mueve `.ai/sessions/` >90d y `.ai/operations/` >180d a
  `.ai/archive/`; `.ai/knowledge/` >180d solo se reporta (nunca se borra sin `supersedes`).
  Dry-run por defecto; `--apply` solo mueve sessions/operations.
- **`context-eval.mjs`**: eval sin LLM con casos reales; mide hit@3/hit@7 de `search_docs` y
  presencia del doc/lesson en `context_brief`. Si baja, es una regresión de ROUTER o ranking.
- **`pc-audit.ps1` (Windows)**: RAM/CPU, antivirus, top procesos, puertos del stack, worktrees y
  cachés; `-Clean` limpia Temp>7d y cachés de package managers sin matar procesos ni tocar
  `node_modules`/Playwright.
- **`prune-worktrees.ps1` (Windows)**: dry-run por defecto; solo poda worktrees **limpios y fusionados**
  en la rama principal, archivando antes `.env`/`appsettings` fuera del workspace.

## 5. Plantilla global y anti-drift

El tooling runtime (`broker.mjs`, `schema.sql`, `session-close.mjs`, `doc-health.mjs`,
`context-compact.mjs`, `context-eval.mjs`, `pc-audit.ps1`, `prune-worktrees.ps1`) es
**copia runtime** de la plantilla canónica (`template/` de este repo; en tu máquina:
`~/.config/opencode/templates/ai-workspace/`).

`doc-health` compara workspace vs plantilla en cada ejecución y avisa si divergen:

```
⚠️ broker desfasado vs plantilla global — ejecuta: Copy-Item "$env:USERPROFILE\.config\opencode\templates\ai-workspace\broker\broker.mjs" .ai\broker\
```

Actualizar el sistema = editar plantilla → copiar a tus workspaces → `doc-health` verde.

## 6. Presupuesto de contexto (los números)

| Elemento                     | Costo                                     |
| ---------------------------- | ----------------------------------------- |
| AGENTS.md raíz (siempre)     | ~4 KB                                     |
| `workspace_overview`         | ~1-3 KB                                   |
| `get_dependencies` (routing) | ~100 B                                    |
| `search_knowledge` (10 hits) | ~1-2 KB                                   |
| `read_doc` de un canónico    | ~3-6 KB (solo cuando toca)                |
| **Cold-start total típico**  | **~5-8 KB** vs **60-100 KB** leyendo todo |
