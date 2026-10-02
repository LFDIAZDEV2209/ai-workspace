# Casos de uso

> Cada caso asume que instalaste el sistema ([README](../README.md#-instalación-en-30-segundos))
> y tienes un agente con el MCP `context-broker` conectado.

## Caso 1 — Proyecto SIN documentación

**Situación**: código en producción, cero docs, tú sabes el proyecto de memoria, los agentes no saben nada.

**Prompt copia-pega**:

```text
Este workspace no tiene documentación estructurada. Instala el sistema .ai/ si no existe
(npx github:LFDIAZDEV2209/ai-workspace) y luego ENTREVÍSTAME para construir el contenido:
hazme UNA pregunta a la vez, con tu respuesta recomendada propuesta primero, sobre:
(1) qué proyectos/repos existen y su responsabilidad, (2) cómo se ejecuta y prueba cada
uno, (3) decisiones técnicas vigentes, (4) tareas pendientes.
Con mis respuestas rellena: .ai/workspace/PROJECTS.md, OVERVIEW.md, ROUTER.md y
AGENT-MATRIX.md. No inventes nada: lo que no sepas y no te haya dicho, márcalo
"sin verificar".
```

**Resultado**: 4 canónicos pequeños con datos reales + el agente ya puede enrutar tareas.

## Caso 2 — Documentación desordenada (PLAN/AUDIT/HANDOFF/CONTINUATION sueltos)

**Situación**: 20+ documentos generados por distintos agentes, duplicados, contradictorios, obsoletos.

**Regla de oro**: **no se borra nada sin verificar**. Primero inventario, después migración.

**Prompt copia-pega**:

```text
Vamos a organizar la documentación de este workspace con el sistema .ai/ ya instalado.
FASE 1 — Inventario (solo leer): enumera TODO fichero .md relevante fuera de node_modules
y archive, con: ruta, tamaño, fecha, tipo (canónico|plan|auditoría|handoff|continuation|
otro), y si duplica/contradice a otro. Preséntalo como tabla y ESPERA mi aprobación.
FASE 2 — Migración (tras mi ok): mueve lo histórico a .ai/archive/ (o docs/history/ del
repo), consolida contenido vigente en los canónicos de .ai/workspace/, registra en
.ai/knowledge/ las decisiones que encuentres (formato ADR), y deja el raíz con solo
README + AGENTS.md. Nada destructivo sin checkeo conmigo.
Al final ejecuta node .ai/scripts/doc-health.mjs y muestra el resultado.
```

## Caso 3 — Workspace multi-repo

**Situación**: varios repos que se relacionan (backend + web + móvil + servicios IA).

**Claves**:

- `PROJECTS.md` mapea repos/puertos/stack/comandos.
- `ROUTER.md` es la tabla que el broker parsea para el routing: regex → repos.

**Ejemplo de ROUTER.md** (así se ve una tabla real):

```markdown
| Keyword regex              | Repos                       |
| -------------------------- | --------------------------- |
| cita\|agenda\|appointment  | backend, web-erp, app-movil |
| programa\|plan-alimentario | backend, app-movil          |
| voice\|voz\|tts            | ai-service                  |
```

**Prompt de verificación**:

```text
Usa get_dependencies con estas 5 tareas y muéstrame qué repos clasificas para cada una:
(1) "arreglar el spinner del wizard de citas en la app", (2) "añadir columna de analytics
al dashboard del ERP", (3) "mejorar el guardrail del chat", (4) "subir build a TestFlight",
(5) "migrar el cache a Redis". Si alguna clasificación no me convence, ajustamos la tabla
de .ai/workspace/ROUTER.md juntos.
```

## Caso 4 — Equipo: cada dev con el sistema en SU PC

**Situación**: N desarrolladores, cada uno con su OpenCode/suscripción y SUS proyectos.
Nadie comparte memoria: cada quien instala el sistema en su máquina y **sus agentes
aprenden a administrar su propia documentación** (la inteligencia es la metodología

- el tooling, no una base compartida).

1. Cada dev ejecuta `npx github:LFDIAZDEV2209/ai-workspace` **en la raíz de su
   proyecto/workspace** — el instalador crea su `.ai/` local y registra el MCP en sus
   agentes (OpenCode/Codex/agy de ESE PC).
2. El conocimiento de cada proyecto vive en SU `.ai/` (se puede commitear al repo del
   proyecto para que el equipo comparta los canónicos vía git — la `memory.db` queda
   local por `.gitignore`, es la sesión de cada máquina).
3. Lo único transversal por máquina es el store global (`~/.ai-workspace/global/`):
   cruza los PROYECTOS de ese dev, nunca entre devs. La primera instalación siembra
   5 lecciones universales (starter pack) — sus agentes nacen con conocimiento
   probado y acumulan el suyo con su trabajo.
4. La metodología vive dentro del `.ai/` instalado (`playbooks/doc-admin.md`,
   `onboarding.md`, gobernanza en `README.md`) — sus agentes saben administrar la
   documentación sin necesidad de leer nada del repo del producto.

**Prompt para el primer día de un dev nuevo** (en su proyecto):

```text
Acabo de instalar el sistema .ai/ en este proyecto. Usa SOLO el sistema .ai/ y el
MCP context-broker: (1) preséntame el workspace (repos, estado, riesgos), (2) dime
qué tareas hay abiertas y cuál es la más urgente, (3) muéstrame las 3 últimas
decisiones registradas. No me hagas leer ficheros a mí: tú consúltalos.
```

## Anti-patrones (lo que NO hay que hacer)

- ❌ Cargar `.ai/` completo en el contexto de cada sesión (el broker existe para evitarlo).
- ❌ Indexar todo el código a la memoria ("NO indexes ciegamente" — la memoria indexa _conocimiento_, no código).
- ❌ Crear un doc nuevo por cada hallazgo (actualiza el canónico; 1 fichero = 1 tema).
- ❌ Meter secretos/keys/contraseñas en `.ai/` (jamás).
- ❌ Escribir en `.ai/` sin actualizar el índice README del tipo (doc-health lo detecta).
