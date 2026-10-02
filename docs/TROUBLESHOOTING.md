# Troubleshooting

> Fallos reales que sufrimos en producción con este sistema y cómo se resolvieron.

## 1. MCP `context-broker: failed — Request timed out` (el clásico)

**Síntoma**: `opencode mcp list` muestra el servidor failed con "Request timed out".

**Causa raíz más común**: el broker (o cualquier MCP stdio) emite frames **sin el envelope
JSON-RPC 2.0**. El cliente MCP valida cada mensaje con un schema estricto:
`{jsonrpc: "2.0", id, result}` — un frame `{"id":1,"result":{...}}` sin `jsonrpc:"2.0"`
es descartado por el validador → el `initialize` nunca se resuelve → timeout (~30 s).

**Cómo diagnosticarlo**:

```bash
# el log del server OpenCode muestra el error Zod exacto:
Select-String -Path "~/.local/share/opencode/log/opencode.log" -Pattern 'mcp transport error'
# si ves invalid_union con path ["jsonrpc"] → frames sin envelope
```

**Cómo reproducirlo localmente** (probe de handshake):

```js
// mcp-probe.mjs
import { spawn } from "node:child_process";
const p = spawn("node", [".ai/broker/broker.mjs"], {
  stdio: ["pipe", "pipe", "ignore"],
});
p.stdout.setEncoding("utf8");
p.stdout.on("data", (d) => console.log("RECV:", d.trim()));
p.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "probe", version: "0" },
    },
  }) + "\n",
);
setTimeout(() => {
  p.kill();
  process.exit(0);
}, 3000);
```

La respuesta correcta empieza con `{"jsonrpc":"2.0",...}`. Si ves otra cosa, ahí está el bug.

**Fix del broker** (si tocas el tuyo): envolver SIEMPRE la salida con el envelope:

```js
process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
```

**Importante**: OpenCode **no reintenta** conexiones MCP fallidas dentro del mismo run del
servicio. Si arreglaste el código y sigue "failed", reconecta:

```bash
opencode api post "/api/experimental/mcp/context-broker/connect?location%5Bdirectory%5D=<ruta-del-proyecto-url-encoded>"
opencode api get  "/api/mcp?location%5Bdirectory%5D=<ruta-del-proyecto-url-encoded>"
```

o reinicia el servicio (`opencode service restart`) / abre sesión nueva.

## 2. `ExperimentalWarning: SQLite is an experimental feature`

**Inofensivo**: es un warning de Node (va a **stderr**, nunca corrompe el protocolo stdio que
lee de stdout). El broker y session-close funcionan igual. Se silencia con:

```bash
node --no-warnings .ai/broker/broker.mjs health
# o en el registro MCP: command = ["node", "--no-warnings", ".ai/broker/broker.mjs"]
```

## 3. Mojibake (acentos rotos) en Windows

**Síntoma**: "DescripciÃ³n" / "dY?-" en lugar de "Descripción" al leer ficheros.

**Causa**: PowerShell 5.1 lee UTF-8-sin-BOM como ANSI en `Get-Content` (display, no el fichero).

**Reglas**:

- Los ficheros del sistema van **UTF-8 sin BOM** (`*.ps1` con BOM).
- Verifica con la herramienta de lectura de tu agente (no con `Get-Content` default).
- **Nunca** escribas ficheros con `Set-Content`/`Out-File` de PS 5.1 (escriben ANSI o UTF-16):
  usa las herramientas de escritura del agente o `Set-Content -Encoding utf8` explícito.

## 4. Concurrencia multi-agente sobre memory.db

Varios agentes (Herdr con 3 panes) abren el broker a la vez sobre el mismo SQLite.

- El broker abre en **WAL** con `busy_timeout = 3000` → lecturas concurrentes OK.
- Escrituras simultáneas pueden devolver `SQLITE_BUSY` → el tool responde `isError: true`
  en vez de colgar; reintenta la llamada.
- Si escalas escrituras concurrentes serias, mueve a un singleton por máquina o usa
  un lock de Valkey (el esquema lo permite).

## 5. Codex / agy no conectan el broker

- **Codex**: `[mcp_servers.context-broker]` en `~/.codex/config.toml` con `command` + `args`
  (ruta **absoluta** recomendada). Reinicia la sesión de Codex tras editar el TOML.
- **agy (Antigravity)**: `agy mcp add context-broker -- node "<abs>/broker.mjs"` y verifica
  con `agy mcp list`. La primera llamada a cada tool pide permiso — aprueba con la opción
  de persistir en settings.json y no volverá a preguntar.
- **Rutas relativas vs absolutas**: OpenCode resuelve el comando relativo contra el
  directorio del proyecto; Codex/agy según cwd de su lanzamiento. Ante la duda: **absoluta**.

## 6. `doc-health` reporta "broker desfasado vs plantilla global"

Actualizaste la plantilla (`~/.config/opencode/templates/ai-workspace/`) y no copiaste al
workspace (o al revés):

```powershell
Copy-Item "$env:USERPROFILE\.config\opencode\templates\ai-workspace\broker\broker.mjs" .ai\broker\
```

## 7. El agente no encuentra el contexto / responde inventando

- ¿Existe `.ai/workspace/OVERVIEW.md` con contenido real? (el overview vacío → sin estado).
- ¿ROUTER.md tiene la tabla con las keywords de tu dominio?
- ¿El broker está conectado en ESTA sesión? (`opencode mcp list`).
- Prueba el test de cold-start de [PROMPTS.md](PROMPTS.md) y compara con lo que debería saber.

## 8. Windows: `npx github:...` falla

- Usa Node ≥ 20 para npx (el broker requiere ≥ 22.5, así que ya lo tienes).
- Alternativa: `git clone` + `node install.mjs` (ver [AGENT-INSTALL.md](../AGENT-INSTALL.md)).
- Si el firewall bloquea, clona el repo y ejecuta el instalador localmente.
