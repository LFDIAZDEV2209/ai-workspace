# Prompt — adoptar el sistema `.ai/` en cualquier workspace

> Copia el bloque en el agente que abras dentro del repo. Sustituye `<...>`.
> El tooling canónico vive en `~/.config/opencode/templates/ai-workspace/`; no lo reinventes.

## Prompt largo (primera adopción)

```text
Actúa como ingeniero senior de plataforma y agentes AI. Este workspace es <WORKSPACE_NAME>,
en <WORKSPACE_PATH>, con rama principal <PRIMARY_BRANCH> y estos repos/servicios: <REPOS>.
Objetivo: dejar el workspace con contexto recuperable, documentación indexada y agentes
entrenados para no leer a ciegas. No implementes producto; solo infraestructura de contexto.

FASE 0 — Inspección (solo lectura)
1. Ejecuta `git status`, `git fetch origin` y revisa la rama. No toques trabajo sucio.
2. Busca `.ai/README.md`, `AGENTS.md`, `openspec/`, `docs/` y `**/docs/`.
3. Cuenta Markdown activo excluyendo node_modules, .git, .worktrees, dist, build, bin, obj,
   .next, .venv y archive. No asumas "20k": mide.
4. Revisa procesos y stack: no mates nada por nombre ni por puerto; verifica PID y ruta.

FASE 1 — Scaffold o adaptación
1. Si no existe `.ai/`, ejecuta:
   node "$env:USERPROFILE\.config\opencode\templates\ai-workspace\scripts\scaffold.mjs"
2. Rellena en este orden: `.ai/workspace/PROJECTS.md`, `OVERVIEW.md`, `ROUTER.md`,
   `AGENT-MATRIX.md`, `OPEN-ITEMS.md`. Usa evidencia real (commits, endpoints, tests), no memoria.
3. Crea `.ai/workspace/DOCS-MAP.md` con: repo, raíz de docs, qué contiene, docs clave y owner.
4. No dupliques el tooling: broker/scripts/playbooks se copian de la plantilla global.

FASE 2 — Broker
1. Verifica que `.ai/broker/broker.mjs` sea la copia de la plantilla global (hash igual).
2. Registra el MCP `context-broker` (stdio, `node .ai/broker/broker.mjs`) en OpenCode,
   Codex y Claude Code. No dupliques servidores ya registrados.
3. Prueba: `node .ai/broker/broker.mjs brief "<tarea real>"`, `docs "<tema>"`,
   `read "<ruta>"`, `health`.
4. El broker debe exponer `context_brief`, `search_docs`, `read_doc`, `record_*` y
   `get_dependencies`. No añadas tools que dupliquen filesystem/grep/codegraph.

FASE 3 — Documentación
1. Indexa solo Markdown activo de `docs/`, `openspec/` y `<repo>/docs/`; excluye archive,
   node_modules, .worktrees, dist, build, bin, obj y .venv.
2. Añade frontmatter solo a docs NUEVOS (`title`, `project`, `type`, `status`, `updated`,
   `tags`). No retrofittees cientos de archivos.
3. Genera un índice `docs/INDEX.md` si el repo tiene >30 docs; enlaza los canónicos.
4. OpenAPI: si el backend genera Swagger en runtime, documenta cómo obtenerlo; si hay spec
   versionada, enlázala. No inventes contratos.

FASE 4 — Contexto y compactación
1. Añade a `AGENTS.md` el protocolo: `workspace_overview` → `context_brief(task)` →
   `search_docs` → `read_doc` (2-3) → `codegraph_explore`.
2. Presupuesto: ≤6 llamadas y ≤8k tokens antes de la primera hipótesis; si se excede, handoff.
3. Copia `.ai/scripts/context-compact.mjs` y documenta: sessions >90d, operations >180d,
   knowledge >180d solo se reporta. Nunca borrar decisions/incidents/lessons sin superseder.
4. Copia `.ai/scripts/pc-audit.ps1` y añade al cierre: `-Disk` si se lanzaron servidores.

FASE 5 — PC (solo Windows)
1. Ejecuta `pc-audit.ps1 -Disk` y reporta RAM, top procesos, puertos, worktrees y cachés.
2. No desinstales antivirus ni desactives servicios sin aprobación explícita.
3. Si hay worktrees: comprueba `git status` + `merge-base --is-ancestor HEAD origin/<main>`;
   solo poda los limpios y fusionados. Archiva `.env`/`appsettings` fuera del workspace.
4. No toques el stack compartido ni procesos de otros agentes.

FASE 6 — Verificación
1. `node .ai/scripts/doc-health.mjs` sin errores.
2. `node .ai/scripts/context-compact.mjs` en dry-run.
3. `node .ai/broker/broker.mjs brief "<tarea>"` devuelve repos + docs + knowledge.
4. `opencode mcp list`, `codex mcp list` y `claude mcp list` muestran `context-broker`.
5. Reporta: qué cambiaste, qué quedó pendiente, qué procesos cerraste.

REGLAS DURAS
- No secretos en el workspace; tokens por variable de entorno.
- No borrar worktrees sucios/no fusionados; no matar por nombre/puerto.
- No crear un segundo índice (Obsidian, embeddings) si el broker ya resuelve.
- Todo en español, UTF-8 sin BOM (ps1 con BOM/CRLF).
```

## Prompt corto (auditoría mensual)

```text
Audita este workspace sin cambiar producto:
1) `node .ai/scripts/doc-health.mjs` y `context-compact.mjs` (dry-run).
2) `node .ai/broker/broker.mjs brief "<tarea de la semana>"` y detecta docs duplicados/stale.
3) `powershell -File .ai/scripts/pc-audit.ps1 -Disk`; reporta RAM, worktrees y cachés.
4) Si hay worktrees limpios y fusionados, propón poda con `prune-worktrees.ps1` (dry-run).
5) Actualiza DOCS-MAP, OPEN-ITEMS y OVERVIEW con evidencia. No borres conocimiento.
```
