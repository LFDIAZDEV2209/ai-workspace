#!/usr/bin/env node
/**
 * Context Broker MCP — servidor MCP stdio zero-dependency (node:sqlite + FTS5).
 *
 * Provee recuperación de contexto bajo demanda para agentes (OpenCode, Codex, agy):
 * no carga nada en el prompt del agente salvo lo que este pida.
 *
 * Registro en agente:
 *   opencode.jsonc  → mcp.servers["context-broker"] = ["node", ".ai/broker/broker.mjs"]
 *   codex config.toml → [mcp_servers.context-broker]
 *
 * Uso CLI (sin MCP):  node .ai/broker/broker.mjs search "<query>" | overview | router "<tarea>" | health
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(HERE, "..", "..");
const DB_PATH = path.join(WORKSPACE_ROOT, ".ai", "memory", "memory.db");
const SCHEMA_PATH = path.join(WORKSPACE_ROOT, ".ai", "memory", "schema.sql");
const WS_DIR = path.join(WORKSPACE_ROOT, ".ai", "workspace");

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
let db;
function openDb() {
  if (db) return db;
  db = new DatabaseSync(DB_PATH);
  if (existsSync(SCHEMA_PATH)) db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  return db;
}

function nowIso() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function nextId(type) {
  const prefix =
    { lesson: "L", decision: "D", incident: "I", pattern: "P", handoff: "S" }[
      type
    ] ?? "X";
  const row = openDb()
    .prepare("SELECT id FROM memory WHERE id LIKE ? ORDER BY id DESC LIMIT 1")
    .get(`${prefix}%`);
  const n = row ? parseInt(row.id.slice(1), 10) + 1 : 1;
  return `${prefix}${String(n).padStart(4, "0")}`;
}

// regilla slug para ficheros de knowledge
function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function writeKnowledgeFile(input, id) {
  const {
    type,
    scope = "PROJECT",
    repo = "",
    title,
    body,
    source = "",
    tags = "",
  } = input;
  const dirMap = {
    lesson: "lessons",
    decision: "decisions",
    incident: "incidents",
    pattern: "patterns",
  };
  const dir = dirMap[type];
  if (!dir) return; // handoff: solo memoria
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(
    WORKSPACE_ROOT,
    ".ai",
    "knowledge",
    dir,
    `${date}-${slugify(title)}.md`,
  );
  if (existsSync(file)) return file; // no sobreescribir
  const content =
    [
      `# ${type[0].toUpperCase()}${type.slice(1)} — ${title}`,
      "",
      `**Fecha:** ${date} · **Scope:** ${scope}${repo ? ` · **Repos:** ${repo}` : ""} · **Status:** activo`,
      source ? `**Evidencia:** ${source}` : "",
      "",
      body,
      "",
      tags ? `**Tags:** ${tags}` : "",
    ]
      .filter(Boolean)
      .join("\n") + "\n";
  try {
    writeFileSync(file, content, "utf8");
    // actualizar índice del README del tipo (fila al final de la tabla si existe)
    const readmePath = path.join(
      WORKSPACE_ROOT,
      ".ai",
      "knowledge",
      dir,
      "README.md",
    );
    if (existsSync(readmePath)) {
      const readme = readFileSync(readmePath, "utf8");
      // auto-index sólo si la tabla tiene columna "Fichero" (cada tipo tiene shape distinto);
      // si no, doc-health marcará "sin indexar" y el agente lo añade a mano con la forma correcta
      const lines = readme.split("\n");
      const iIdx = lines.findIndex((l) => l.trim() === "## Índice");
      const headerRow =
        iIdx >= 0
          ? lines.find((l, i) => i > iIdx && l.trim().startsWith("|"))
          : "";
      if (headerRow && /fichero/i.test(headerRow)) {
        const row = `| ${id} | ${date} | ${title.replace(/\|/g, "/")} | ${path.basename(file)} |`;
        const updated = readme.replace(
          /(## Índice[\s\S]*?)((?:\n\n[^|]|$))/,
          `$1\n${row}$2`,
        );
        writeFileSync(readmePath, updated, "utf8");
      }
    }
  } catch {
    /* nunca romper por IO */
  }
  return file;
}

function upsertMemory(input) {
  const {
    type,
    scope = "PROJECT",
    project = "",
    repo = "",
    title,
    body,
    source = "",
    commit_sha = "",
    confidence = "verified",
    supersedes = "",
    tags = "",
  } = input;
  if (!["lesson", "decision", "incident", "pattern", "handoff"].includes(type))
    throw new Error(`type inválido: ${type}`);
  if (
    !["GLOBAL", "WORKSPACE", "PROJECT", "SESSION", "EPHEMERAL"].includes(scope)
  )
    throw new Error(`scope inválido: ${scope}`);
  if (!title || !body) throw new Error("title y body son obligatorios");
  // project por defecto: nombre del workspace (sin hardcodear ningún producto)
  const projectName = project || path.basename(WORKSPACE_ROOT).toLowerCase();
  const d = openDb();
  const id = nextId(type);
  d.prepare(
    `INSERT INTO memory (id, type, scope, project, repo, title, body, status, source, commit_sha, confidence, supersedes, tags, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    type,
    scope,
    projectName,
    repo,
    title,
    body,
    "active",
    source,
    commit_sha,
    confidence,
    supersedes,
    tags,
    nowIso(),
    nowIso(),
  );
  if (supersedes) {
    d.prepare(
      "UPDATE memory SET status='superseded', updated_at=? WHERE id=?",
    ).run(nowIso(), supersedes);
  }
  writeKnowledgeFile(input, id);
  return id;
}

// Escaneo vivo de ficheros canónicos de .ai/knowledge (el fichero manda; cero staleness)
const KNOWLEDGE_DIRS = ["lessons", "decisions", "incidents", "patterns"];
function scanKnowledgeFiles(query, { type = "", limit = 12 } = {}) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (!terms.length) return [];
  const dirs = type ? [type + "s"] : KNOWLEDGE_DIRS;
  const hits = [];
  for (const dir of dirs) {
    const p = path.join(WORKSPACE_ROOT, ".ai", "knowledge", dir);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p)) {
      if (!f.endsWith(".md") || f === "README.md") continue;
      const raw = readFileSync(path.join(p, f), "utf8");
      const lower = raw.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (f.toLowerCase().includes(t)) score += 3;
        if (lower.includes(t)) score += 1;
      }
      if (score > 0) {
        hits.push({
          id: f.replace(/\.md$/, ""),
          type: dir.replace(/s$/, ""),
          score,
          title: (raw.match(/^#\s+(?:L\d+ — )?(.+)$/m)?.[1] ?? f).trim(),
          snippet: raw
            .split("\n")
            .filter(Boolean)
            .slice(1, 5)
            .join(" ")
            .slice(0, 220),
        });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function searchMemory(
  query,
  { scope = "", repo = "", type = "", limit = 10 } = {},
) {
  const d = openDb();
  const params = [];
  let sql = `
    SELECT m.id, m.type, m.scope, m.repo, m.title, m.status, m.confidence, m.supersedes, m.tags,
           substr(m.body, 1, 500) AS excerpt,
           snippet(memory_fts, 1, '›', '‹', '…', 24) AS snippet,
           bm25(memory_fts) AS rank
      FROM memory_fts f JOIN memory m ON m.rowid = f.rowid
     WHERE memory_fts MATCH ?`;
  params.push(query);
  if (type) {
    sql += " AND m.type = ?";
    params.push(type);
  }
  if (scope) {
    sql += " AND m.scope = ?";
    params.push(scope);
  }
  if (repo) {
    sql += " AND (m.repo LIKE ? OR m.repo = 'workspace')";
    params.push(`%${repo}%`);
  }
  sql += " ORDER BY rank LIMIT ?";
  params.push(limit);
  return d.prepare(sql).all(...params);
}

// ---------------------------------------------------------------------------
// Docs canónicos (el código y los docs mandan; la memoria solo indexa)
// ---------------------------------------------------------------------------
function readWs(rel) {
  const p = path.join(WS_DIR, rel);
  if (!existsSync(p)) return `⚠️ fichero no encontrado: .ai/workspace/${rel}`;
  return readFileSync(p, "utf8");
}

function routeTask(task) {
  const routerMd = readWs("ROUTER.md");
  const text = task.toLowerCase();
  // Única fuente: la tabla del ROUTER.md (regex → repos CSV). Sin duplicar en código.
  const rows = routerMd
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.startsWith("|") &&
        !l.includes("---") &&
        !/^\|\s*(Keyword|regex)/i.test(l),
    )
    .map((l) => {
      // respeta pipes escapadas `\|` de las tablas markdown
      const cells = l
        .split(/(?<!\\)\|/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      if (cells.length < 2) return null;
      const pattern = cells[0].replace(/\\\|/g, "|");
      const repos = cells[1];
      if (!pattern || !repos || repos.length < 3) return null;
      try {
        return { re: new RegExp(pattern, "i"), repos: repos.split(/,\s*/) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const matches = rows
    .filter(({ re }) => re.test(text))
    .flatMap(({ repos }) => repos);
  const repos = matches.length
    ? [...new Set(matches)]
    : ["⚠️ tarea no clasificada — consulta OVERVIEW.md"];
  return { task, repos, nota: "tabla fuente: .ai/workspace/ROUTER.md" };
}

// ---------------------------------------------------------------------------
// Tools MCP
// ---------------------------------------------------------------------------
function toolOverview() {
  const d = openDb();
  const count = (t) =>
    d
      .prepare("SELECT COUNT(*) c FROM memory WHERE type=? AND status='active'")
      .get(t).c;
  const changesDir = path.join(WORKSPACE_ROOT, "openspec", "changes");
  const activeChanges = existsSync(changesDir)
    ? readdirSync(changesDir).filter((n) => n !== "archive")
    : [];
  const overview = readWs("OVERVIEW.md");
  // primeras secciones del doc canónico (progressive disclosure; cero contenido hardcodeado)
  const sections = overview
    .split(/^## /m)
    .slice(1, 4)
    .map((s) => `## ${s.trimEnd()}`)
    .join("\n\n");
  return [
    `## Workspace ${path.basename(WORKSPACE_ROOT)} — Overview`,
    "",
    "Resumen mínimo; el detalle va bajo demanda (read_doc / search_knowledge).",
    "",
    sections || overview.slice(0, 2000),
    "",
    `### Memoria activa`,
    `lessons: ${count("lesson")} · decisions: ${count("decision")} · incidents: ${count("incident")} · patterns: ${count("pattern")}`,
    `(memory.db = log íntegro de lo registrado; el texto canónico y siempre fresco vive en .ai/knowledge/<tipo>/)`,
    ...(existsSync(changesDir)
      ? [`openspec changes activos: ${activeChanges.length}`]
      : []),
    "",
    "### Lee on-demand (progressive disclosure)",
    "- PROJECTS.md (mapa de repos/puertos) · ROUTER.md (tarea→repos) · AGENT-MATRIX.md (agente según tarea) · OPEN-ITEMS.md (backlog)",
    "- knowledge/{decisions,lessons,incidents,patterns}/ · playbooks/",
  ].join("\n");
}

function toolProjectContext(repo) {
  // genérico: el nombre del repo es el directorio (normaliza _ por - como cortesía)
  const dir = repo?.replace(/_/g, "-") ?? repo;
  const agentsPath = path.join(WORKSPACE_ROOT, dir, "AGENTS.md");
  let agents = "";
  if (existsSync(agentsPath)) {
    const raw = readFileSync(agentsPath, "utf8");
    // resumen: headers + primeras líneas de cada sección (progressive disclosure)
    const sections = raw
      .split(/^## /m)
      .slice(1, 8)
      .map((s) => {
        const [head, ...body] = s.split("\n");
        return `## ${head.trim()}\n${body.slice(0, 3).join("\n").trim()}`;
      });
    agents = `AGENTS.md del repo (secciones):\n${sections.join("\n\n")}`;
  } else agents = `sin AGENTS.md en ${dir}`;
  const kb = searchMemory("*", { repo: dir, limit: 8 })
    .map((r) => `- [${r.type}] ${r.title}`)
    .join("\n");
  return `# Contexto: ${dir}\n\n${agents}\n\n### Memoria relacionada\n${kb || "sin entradas"}`;
}

function toolGetCurrentState() {
  return readWs("OVERVIEW.md");
}
function toolGetOpenTasks() {
  const items = path.join(WORKSPACE_ROOT, ".ai", "workspace", "OPEN-ITEMS.md");
  return existsSync(items) ? readFileSync(items, "utf8") : "sin OPEN-ITEMS.md";
}
function toolGetKnowledge(dir, filter = {}) {
  const d = openDb();
  const rows = d
    .prepare(
      `SELECT id,type,scope,repo,title,status,tags FROM memory WHERE type=? ORDER BY updated_at DESC`,
    )
    .all(dir);
  const db = rows
    .map(
      (r) =>
        `${r.id} [${r.scope}] ${r.title} (${r.status}${r.tags ? " · " + r.tags : ""})`,
    )
    .join("\n");
  // ficheros canónicos: la fuente de verdad del texto completo (memoria solo indexa)
  const dirPath = path.join(WORKSPACE_ROOT, ".ai", "knowledge", dir + "s");
  let files = "";
  try {
    files = readdirSync(dirPath)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .map((f) => {
        const raw = readFileSync(path.join(dirPath, f), "utf8");
        const title = (raw.match(/^#\s+(.+)$/m)?.[1] ?? f).trim();
        return `- .ai/knowledge/${dir}s/${f} — ${title}`;
      })
      .join("\n");
  } catch {
    /* directorio sin ficheros */
  }
  const parts = [];
  if (db) parts.push(db);
  if (files)
    parts.push(`### Ficheros canónicos (.ai/knowledge/${dir}s/)\n${files}`);
  return parts.join("\n\n") || "sin entradas";
}
function toolGetDoc(file) {
  if (!file)
    return "⚠️ falta el argumento { file: \"ruta/relativa/a/.ai\" } — ej: file='workspace/OVERVIEW.md'";
  const safe = file.replace(/\\/g, "/").replace(/^\.ai\//, "");
  const p = path.join(WORKSPACE_ROOT, ".ai", safe);
  if (!existsSync(p) || !p.startsWith(WORKSPACE_ROOT + path.sep + ".ai"))
    return "⚠️ ruta fuera de .ai o inexistente";
  return readFileSync(p, "utf8");
}

function toolHealth() {
  const d = openDb();
  const total = d.prepare("SELECT COUNT(*) c FROM memory").get().c;
  const stale = d
    .prepare(
      "SELECT COUNT(*) c FROM memory WHERE updated_at < datetime('now','-60 days')",
    )
    .get().c;
  return `memory.db OK · ${total} entradas · ${stale} sin tocar hace >60d · WAL activo`;
}

const TOOLS = [
  [
    "workspace_overview",
    "Resumen mínimo del workspace: repos, estado, contadores. Primera llamada recomendada.",
    () => toolOverview(),
  ],
  [
    "project_context",
    "Contexto de un repo: secciones de su AGENTS.md + memoria relacionada.",
    (a) => toolProjectContext(a.repo),
  ],
  [
    "search_knowledge",
    "Búsqueda híbrida: FTS de memoria (handoffs/ephemeral) + escaneo vivo de .ai/knowledge (siempre fresco).",
    (a) => {
      const dbHits = searchMemory(a.query, a).map(
        (r) => `${r.id} [${r.type}/${r.scope}] ${r.title}\n  ${r.snippet}`,
      );
      const fileHits = scanKnowledgeFiles(a.query, a).map(
        (r) => `${r.id} [${r.type}] ${r.title}\n  ${r.snippet}`,
      );
      const all = [...dbHits, ...fileHits];
      return all.join("\n\n") || "sin resultados";
    },
  ],
  [
    "get_current_state",
    "Estado por módulo con evidencia (OVERVIEW.md completo).",
    () => toolGetCurrentState(),
  ],
  [
    "get_decisions",
    "Índice de decisiones (ADRs).",
    () => toolGetKnowledge("decision"),
  ],
  ["get_lessons", "Índice de lessons.", () => toolGetKnowledge("lesson")],
  ["get_incidents", "Índice de incidents.", () => toolGetKnowledge("incident")],
  ["get_open_tasks", "Backlog vivo OPEN-ITEMS.md.", () => toolGetOpenTasks()],
  [
    "get_dependencies",
    "Router: repos+docs involucrados según texto de tarea.",
    (a) => JSON.stringify(routeTask(a.task), null, 1),
  ],
  [
    "read_doc",
    "Lee un doc de .ai/ bajo demanda. CLAVE del argumento: `file` (no `path`). Ej: file='workspace/OVERVIEW.md'.",
    (a) => toolGetDoc(a.file),
  ],
  [
    "record_decision",
    "Registra decisión. {title, body, repo?, scope?, supersedes?, tags?}",
    (a) => `decisión ${upsertMemory({ ...a, type: "decision" })} registrada`,
  ],
  [
    "record_lesson",
    "Registra lesson. {title, body, repo?, scope?, source?, tags?}",
    (a) => `lesson ${upsertMemory({ ...a, type: "lesson" })} registrada`,
  ],
  [
    "record_incident",
    "Registra incident. {title, body, repo?, scope?, source?}",
    (a) => `incident ${upsertMemory({ ...a, type: "incident" })} registrada`,
  ],
  [
    "session_handoff",
    "Handoff de fin de sesión: registra entrada tipo handoff con resumen y toca docs.",
    (a) => {
      const id = upsertMemory({
        ...a,
        type: "handoff",
        scope: a.scope ?? "SESSION",
      });
      return `handoff ${id} registrada en memoria. Recuerda: actualizar OVERVIEW.md/OPEN-ITEMS.md si corresponde.`;
    },
  ],
  ["memory_health", "Salud de la memoria.", () => toolHealth()],
];

// ---------------------------------------------------------------------------
// MCP stdio (JSON-RPC 2.0, newline-delimited)
// ---------------------------------------------------------------------------
function send(msg) {
  // envelope JSON-RPC 2.0 obligatorio: OpenCode/Codex validan el campo jsonrpc
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
}

function handle(req) {
  const { id, method, params } = req;
  if (method === "initialize") {
    return send({
      id,
      result: {
        // eco de la versión pedida por el cliente (fallback 2024-11-05)
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "context-broker", version: "1.0.3" },
      },
    });
  }
  if (method === "tools/list") {
    return send({
      id,
      result: {
        tools: TOOLS.map(([name, description]) => ({
          name,
          description,
          inputSchema: {
            type: "object",
            properties: {
              repo: { type: "string" },
              query: { type: "string" },
              task: { type: "string" },
              file: { type: "string" },
              title: { type: "string" },
              body: { type: "string" },
              type: { type: "string" },
              scope: { type: "string" },
              source: { type: "string" },
              tags: { type: "string" },
              supersedes: { type: "string" },
            },
          },
        })),
      },
    });
  }
  if (method === "tools/call") {
    const name = params.name;
    const tool = TOOLS.find((t) => t[0] === name);
    if (!tool)
      return send({
        id,
        error: { code: -32602, message: `tool desconocida: ${name}` },
      });
    try {
      const out = tool[2](params.arguments ?? {});
      return send({
        id,
        result: { content: [{ type: "text", text: String(out) }] },
      });
    } catch (e) {
      return send({
        id,
        result: {
          content: [{ type: "text", text: `error: ${e.message}` }],
          isError: true,
        },
      });
    }
  }
  if (method === "ping") return send({ id, result: {} });
  // recursos no soportados: lista vacía en vez de -32601 (reduce ruido del cliente MCP)
  if (method === "resources/list")
    return send({ id, result: { resources: [] } });
  if (method === "resources/templates/list")
    return send({ id, result: { templates: [] } });
  // notification o método desconocido: sin respuesta salvo error en request
  if (id !== undefined)
    send({
      id,
      error: { code: -32601, message: "método desconocido: " + method },
    });
}

// CLI directo
if (process.argv.length > 2) {
  const [cmd, ...args] = process.argv.slice(2);
  const out = {
    search: () => {
      const dbHits = searchMemory(args.join(" ")).map(
        (r) => `${r.id} [${r.type}] ${r.title}\n  ${r.snippet}`,
      );
      const fileHits = scanKnowledgeFiles(args.join(" ")).map(
        (r) => `${r.id} [${r.type}] ${r.title}\n  ${r.snippet}`,
      );
      const all = [...dbHits, ...fileHits];
      return all.join("\n\n") || "sin resultados";
    },
    overview: toolOverview,
    router: () => JSON.stringify(routeTask(args.join(" ")), null, 1),
    health: toolHealth,
    seed: () => {
      openDb();
      return "schema aplicado";
    },
  }[cmd];
  console.log(out ? out() : `comandos: search|overview|router|health|seed`);
  process.exit(0);
}

// Modo MCP stdio
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch (e) {
      // frame no parseable: -32700 con id null (JSON-RPC) para que el cliente no quede colgado esperando
      try {
        send({
          id: null,
          error: {
            code: -32700,
            message: "parse error: " + (e?.message ?? "JSON inválido"),
          },
        });
      } catch {
        /* stdout cerrado: nada que hacer */
      }
    }
  }
});
process.stdin.on("end", () => process.exit(0));
