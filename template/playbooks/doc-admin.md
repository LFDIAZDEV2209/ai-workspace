# Playbook — Administración de documentación

> Objetivo: que la documentación del workspace siga pequeña, fresca y sin duplicados.
> Regla de oro: **NADA se borra sin verificación**. Siempre: inventario → aprobación → migración.

## Diagnóstico (siempre primero)

```bash
node .ai/scripts/doc-health.mjs
```

- docs de sesión fuera de archive → candidatos a archivar/consolidar
- canónicos >12 KB → recortar (el detalle va a subdocs on-demand)
- `.ai/` stale >45 días → revisar si siguen vigentes
- títulos duplicados / ficheros sin indexar → consolidar e indexar

## Caso A — Documentación dispersa (PLAN/AUDIT/HANDOFF/CONTINUATION sueltos)

1. **INVENTARIO (solo leer)**: tabla de todos los `.md` relevantes fuera de node_modules
   y archive con: ruta, tamaño, fecha, tipo (canónico|plan|auditoría|handoff|continuation|otro)
   y qué ficheros duplica/contradice. **Presentar al usuario y esperar aprobación.**
2. **CLASIFICAR**: vigente → consolidar en los canónicos (`.ai/workspace/` o `docs/` del repo);
   histórico → `.ai/archive/` (o `docs/history/` del repo); decisión importante →
   `.ai/knowledge/decisions/` (ADR); temporal → borrar SOLO si el usuario lo aprueba.
3. **MIGRAR**: mover (nunca borrar de primero), actualizar los índices README de knowledge,
   dejar la raíz limpia (README + AGENTS.md).
4. **VERIFICAR**: `doc-health` verde + prueba cold-start (¿un agente nuevo entiende el
   workspace usando solo `.ai/`?).

## Caso B — Proyecto SIN documentación

Entrevistar al usuario (una pregunta a la vez, con la respuesta recomendada propuesta
primero) → rellenar PROJECTS/OVERVIEW/ROUTER/AGENT-MATRIX con datos verificados; lo no
confirmado se marca `sin verificar`. **Nunca inventar.**

## Caso C — Mantenimiento continuo (cada sesión)

- Cambió el estado de un módulo → `OVERVIEW.md` (tabla con evidencia: commits/tests/fechas).
- Tareas nuevas/cerradas → `OPEN-ITEMS.md` (única lista de pendientes del workspace).
- Aprendizaje → `record_lesson` / `record_decision` / `record_incident` con el scope
  correcto (GLOBAL solo si aplica a cualquier proyecto → va al store de la máquina).
- Cierre → `node .ai/scripts/session-close.mjs` + completar su checklist.

## Reglas (resumen de gobernanza — detalle en `.ai/README.md`)

1. Un fichero = un tema. Prohibidos `PLAN-FINAL-X` / `CONTINUATION-X` / `HANDOFF-X` sueltos.
2. Canónicos pequeños (≤ ~6-10 KB); el detalle va a subdocs que se leen on-demand.
3. El código manda sobre la memoria: discrepancia = corregir la memoria.
4. Sin secretos jamás en `.ai/`.
5. scope GLOBAL solo para conocimiento válido en cualquier proyecto de esta máquina.
