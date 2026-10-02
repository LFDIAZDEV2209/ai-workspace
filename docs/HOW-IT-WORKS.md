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
            (.ai/sessions/ → purga a 30 días · handoffs → memory.db)
```

**Qué se carga SIEMPRE**: solo el `AGENTS.md` raíz (~4 KB: mapa del sistema + reglas invariables).
**Todo lo demás es on-demand** vía el broker.

## 2. El Context Broker (MCP stdio)

`template/broker/broker.mjs` — un único fichero **zero-dependency** (solo `node:sqlite`,
incluido desde Node 22.5) que habla **JSON-RPC 2.0 sobre stdio, delimitado por newlines**
(NDJSON), el transporte estándar MCP.

**15 tools**:

| Tool                                                    | Qué hace                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| `workspace_overview`                                    | Resumen mínimo (lee OVERVIEW.md dinámicamente; cero hardcode)        |
| `project_context`                                       | Contexto de un repo: secciones de su AGENTS.md + memoria relacionada |
| `search_knowledge`                                      | Búsqueda híbrida: FTS de memoria + escaneo vivo de `.ai/knowledge/`  |
| `get_current_state` / `get_open_tasks`                  | OVERVIEW.md / OPEN-ITEMS.md completos                                |
| `get_decisions` / `get_lessons` / `get_incidents`       | Índices con ruta del fichero canónico                                |
| `get_dependencies`                                      | **Router**: texto de tarea → repos involucrados (tabla de ROUTER.md) |
| `read_doc`                                              | Lee cualquier doc de `.ai/` bajo demanda                             |
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

`search_knowledge` busca en DOS fuentes y fusiona:

1. **memory.db (FTS5)** — lo registrado por los agentes (handoffs, lessons…).
2. **Escaneo vivo de `.ai/knowledge/**/*.md`** — score por presencia del término en
   nombre de fichero y contenido. **Siempre fresco**: si un agente edita el fichero
   hace 3 segundos, la búsqueda lo ve (la memoria es solo el índice; **el código y los
   docs mandan**).

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

| Scope       | Vive en                               | Purga         |
| ----------- | ------------------------------------- | ------------- |
| `EPHEMERAL` | notas sueltas, capturas, .bak         | tras la tarea |
| `SESSION`   | `.ai/sessions/` + handoffs en memoria | 30 días       |
| `PROJECT`   | `docs/` del repo o knowledge del repo | permanente    |
| `WORKSPACE` | `.ai/knowledge/` + `.ai/workspace/`   | permanente    |
| `GLOBAL`    | `~/.config/opencode/`                 | permanente    |

## 4. Gobernanza (las reglas que evitan el monstruo)

1. **Un fichero = un tema.** Prohibidos `PLAN-FINAL-X`, `CONTINUATION-X`, `AUDIT-X`, `HANDOFF-X` sueltos.
2. **Canónicos pequeños**: OVERVIEW/PROJECTS/ROUTER/AGENT-MATRIX/OPEN-ITEMS ≤ ~6 KB c/u.
3. **Progressive disclosure**: resumen primero (`overview`), detalle solo si hace falta (`read_doc`).
4. **El código manda**: memoria desactualizada pierde contra el código; al detectarlo se corrige la memoria.
5. **No indexar a ciegas**: la memoria se alimenta por `record_*` explícitos y el pipeline de cierre.
6. **Sin secretos jamás** en `.ai/` (ni keys ni contraseñas).

## 5. Plantilla global y anti-drift

El tooling runtime (`broker.mjs`, `schema.sql`, `session-close.mjs`, `doc-health.mjs`) es
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
