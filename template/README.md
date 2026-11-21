# .ai — Sistema de conocimiento del workspace {{WORKSPACE_NAME}}

> creado {{FECHA}}. Memoria, conocimiento y playbooks del workspace multi-repo.
> PRINCIPIO: reducir contexto, no aumentar. Todo fichero ≤10 KB; detalle on-demand.

## Cómo entra un agente nuevo (cold-start)

1. `.ai/playbooks/onboarding.md` — pasos 1-3 obligatorios (≤2 min)
2. Context Broker MCP si está disponible; si no, CLI:
   ```powershell
   node .ai/broker/broker.mjs overview                 # resumen workspace
   node .ai/broker/broker.mjs brief "<tarea>"          # router + docs + knowledge + open items
   node .ai/broker/broker.mjs docs "<keywords>"        # FTS5 docs/openspec + specs OpenAPI
   node .ai/broker/broker.mjs read "<ruta>"            # doc concreto (allowlist + truncado)
   node .ai/broker/broker.mjs router "<tarea>"         # repos involucrados
   node .ai/broker/broker.mjs search "<keywords>"      # lessons/decisions/handoffs
   node .ai/broker/broker.mjs health                   # estado memoria
   ```

## Estructura

```
.ai/
  README.md            ← ESTE fichero (gobernanza)
  workspace/           ← docs canónicos vivos (se editan con cada sesión)
    OVERVIEW.md          estado por módulo con evidencia
    PROJECTS.md          repos, puertos, gateway, schemas
    ROUTER.md            tarea → repos (parseada por el broker)
    AGENT-MATRIX.md      agente/modelo según tarea
    OPEN-ITEMS.md        backlog vivo
    DOCS-MAP.md          raíces de docs + protocolo de retrieval
  knowledge/           ← conocimiento estructurado, 1 fichero = 1 entrada
    decisions/ lessons/ incidents/ patterns/
  playbooks/           ← procedimientos operativos
    onboarding.md  qa.md  herdr.md  doc-admin.md  PROMPT-ADOPT-WORKSPACE.md
  memory/              ← SQLite + FTS5 (zero-dep node:sqlite)
    memory.db  schema.sql
  scripts/             ← automatización
    session-close.mjs  doc-health.mjs  context-compact.mjs  context-eval.mjs
    pc-audit.ps1 (Windows)  prune-worktrees.ps1 (Windows)
  broker/              ← Context Broker MCP (stdio, JSON-RPC)
  operations/          ← evidencia de QA/auditorías/releases
  sessions/            ← handoffs de sesión (EPHEMERAL; compactar >90 días)
  archive/             ← historial: NUNCA cargar en contexto salvo necesidad explícita
```

## Gobernanza (reglas de escritura)

1. **Un fichero = un tema.** Sin PLAN-FINAL / CONTINUATION / AUDIT / HANDOFF sueltos.
2. **Los canónicos viven en `workspace/` y `knowledge/`.** Al terminar una sesión:
   `node .ai/scripts/session-close.mjs` + actualizar OVERVIEW/OPEN-ITEMS manualmente.
3. **Clasificación de conocimiento:**
   - EPHEMERAL — borrable tras la tarea (capturas, .bak, notas sueltas).
   - SESSION — handoffs en `.ai/sessions/` (se compactan a los 90 días).
   - PROJECT — afecta a un repo (lessons/decisions del repo, o `docs/` del repo).
   - WORKSPACE — afecta a varios repos (`.ai/knowledge/`).
   - GLOBAL — aplicable a CUALQUIER proyecto: se escribe en el store global de la
     máquina (`~/.ai-workspace/global/`) y **todos los brokers de este PC lo leen**
     (los hits aparecen marcados `[global]` en las búsquedas de cualquier proyecto).
     Solo PROJECT/WORKSPACE/GLOBAL entran en memoria permanente.
4. **El código manda.** Si memoria y código discrepan, gana el código y se actualiza la memoria.
5. **Nada de indexar todo a ciegas.** La memoria se alimenta por registros explícitos
   (broker `record_*`) y del pipeline de cierre de sesión.
6. **Sin secretos jamás** en este árbol (ni contraseñas ni keys).
7. **Compactación**: sessions >90d y operations >180d se archivan; knowledge >180d solo se
   reporta y requiere revisión humana. `node .ai/scripts/context-compact.mjs` (dry-run).
8. **PC**: `powershell -File .ai/scripts/pc-audit.ps1 -Disk` al cerrar si se lanzaron
   servidores/tests; `-Clean` mensual de Temp/cachés. `prune-worktrees.ps1` solo poda
   worktrees limpios y fusionados.

## Origen del tooling genérico (anti-drift)

`broker.mjs`, `schema.sql`, `doc-health.mjs`, `session-close.mjs`, `context-compact.mjs`,
`context-eval.mjs`, `pc-audit.ps1` y `prune-worktrees.ps1` son copias runtime de la
plantilla canónica global en `~/.config/opencode/templates/ai-workspace/`. Para actualizar:

1. edita la plantilla global, 2) copia a este workspace, 3) `doc-health` avisa si divergen.
