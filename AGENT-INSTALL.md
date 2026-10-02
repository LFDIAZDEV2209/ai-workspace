# Instalación por prompt — pega esto en tu agente

> Copia y pega el bloque de abajo en tu OpenCode (o Codex/agy) abierto en la raíz de tu
> proyecto o workspace. El agente hace todo solo.

```text
Vas a instalar el sistema "ai-workspace" (contexto, conocimiento y memoria con
recuperación bajo demanda) en este workspace. Procede así:

1. Instala con el comando:
   npx github:LFDIAZDEV2209/ai-workspace
   Si npx no está disponible, clona y ejecuta:
   git clone https://github.com/LFDIAZDEV2209/ai-workspace %TEMP%\ai-workspace
   cd %TEMP%\ai-workspace && node install.mjs

2. Verifica que quedó bien:
   - Existe .ai/ con README.md, broker/broker.mjs, memory/schema.sql,
     workspace/*.md, playbooks/ y scripts/.
   - El comando: node .ai/broker/broker.mjs health responde OK.
   - El MCP context-broker quedó registrado (opencode mcp list muestra "connected").

3. Ahora rellena el contenido con datos REALES de este workspace (nada inventado;
   pregunta lo que falte):
   a) .ai/workspace/PROJECTS.md   → cada repo/carpeta: qué es, puerto, stack,
      comando de build y test.
   b) .ai/workspace/OVERVIEW.md   → estado por módulo CON EVIDENCIA (commits,
      tests, fechas). Si no tienes evidencia, marca "sin verificar".
   c) .ai/workspace/ROUTER.md     → tabla regex → repos (ej: ".*(cita|agenda).* → api,app").
   d) .ai/workspace/AGENT-MATRIX.md → qué agente/modelo para cada tipo de tarea.

4. Si ya tengo documentación dispersa (PLAN/AUDIT/HANDOFF/CONTINUATION), sigue
   el CASO 2 de docs/USE-CASES.md del repo: inventario primero, consolidación
   después, sin borrar nada sin verificarlo conmigo.

5. Registra la primera decisión con: node .ai/broker/broker.mjs (tool record_decision)
   y termina leyendo .ai/README.md (gobernanza) para futuras sesiones.

Reporta al final: qué instalaste, qué rellenaste y qué quedó pendiente de mi input.
```

## Notas

- **Node ≥ 22.5** requerido (usa `node:sqlite` experimental — funciona sin flags en 22.13+).
- El instalador es **idempotente**: si `.ai/` ya existe, no pisa nada.
- Sin conexión a internet tras la instalación: todo es local (SQLite + ficheros).
- Sin secretos: el sistema nunca pide API keys.
