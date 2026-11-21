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
 * Uso CLI (sin MCP):  node .ai/broker/broker.mjs search|docs "<query>" | brief "<tarea>" |
 *                     read "<ruta>" | overview | router "<tarea>" | health
 */
import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  statSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(HERE, "..", "..");
const DB_PATH = path.join(WORKSPACE_ROOT, ".ai", "memory", "memory.db");
const SCHEMA_PATH = path.join(WORKSPACE_ROOT, ".ai", "memory", "schema.sql");
const WS_DIR = path.join(WORKSPACE_ROOT, ".ai", "workspace");
// Store GLOBAL de la máquina: conocimiento cross-proyecto. Todo broker de este PC
// lee aquí; los registros con scope GLOBAL se escriben aquí (los demás, al local).
const GLOBAL_DIR = path.join(os.homedir(), ".ai-workspace", "global");
const GLOBAL_DB_PATH = path.join(GLOBAL_DIR, "memory.db");

// ---------------------------------------------------------------------------
// Índice de documentación (Markdown de repos, OpenSpec y .ai) — FTS5 en memoria
// ---------------------------------------------------------------------------
// Se indexa bajo demanda (primer search_docs/context_brief) y se reconstruye
// cada 10 min. No persiste estado: cero staleness y cero ficheros nuevos.
const DOC_SKIP_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".worktrees",
  ".next",
  "dist",
  "build",
  "bin",
  "obj",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
  ".turbo",
  "archive",
]);
const DOC_MAX_BYTES = 1024 * 1024;
// ROUTER/OPEN-ITEMS tienen tools dedicadas: indexarlos duplica ruido en el brief.
const DOC_SKIP_FILES = new Set(["ROUTER.md", "OPEN-ITEMS.md"]);
const DOCS_TTL_MS = 10 * 60 * 1000;
let docsDb;
let docsBuiltAt = 0;
let docsStats = { count: 0, buildMs: 0 };

function docRoots() {
  const roots = [];
  const add = (dir, repo) => {
    if (existsSync(dir)) roots.push({ dir, repo });
  };
  add(path.join(WORKSPACE_ROOT, "docs"), "workspace/docs");
  add(path.join(WORKSPACE_ROOT, "openspec"), "openspec");
  add(path.join(WORKSPACE_ROOT, ".ai", "workspace"), "workspace/.ai");
  add(path.join(WORKSPACE_ROOT, ".ai", "operations"), "workspace/.ai");
  for (const e of readdirSync(WORKSPACE_ROOT, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    if (DOC_SKIP_SEGMENTS.has(e.name)) continue;
    add(path.join(WORKSPACE_ROOT, e.name, "docs"), e.name);
  }
  return roots;
}

function collectDocs() {
  const seen = new Set();
  const seenSig = new Set();
  const docs = [];
  const walk = (dir, repo) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // No seguir symlinks/junctions: evita bucles y fugas fuera del workspace.
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (DOC_SKIP_SEGMENTS.has(e.name)) continue;
        walk(abs, repo);
        continue;
      }
      const isMarkdown = /\.mdx?$/i.test(e.name);
      // Specs OpenAPI/Swagger: sí; package.json/lockfiles: no.
      const isSpec =
        /\.(json|ya?ml)$/i.test(e.name) &&
        /openapi|swagger|contract/i.test(abs);
      if (!e.isFile() || (!isMarkdown && !isSpec)) continue;
      if (DOC_SKIP_FILES.has(e.name)) continue;
      if (seen.has(abs)) continue;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.size > DOC_MAX_BYTES) continue;
      let raw;
      try {
        raw = readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
      } catch {
        continue;
      }
      // Copias idénticas en varios repos (p. ej. docs/elevenlabs): indexar una.
      const sig = createHash("sha1").update(raw).digest("hex");
      if (seenSig.has(sig)) continue;
      seenSig.add(sig);
      const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const fmTitle = fm?.[1]
        .match(/^title:\s*(.+)$/m)?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, "");
      const h1 = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const h2 = raw.match(/^##\s+(.+)$/m)?.[1]?.trim();
      const title = (
        fmTitle ||
        h1 ||
        h2 ||
        e.name.replace(/\.mdx?$/i, "")
      ).slice(0, 160);
      docs.push({
        path: path.relative(WORKSPACE_ROOT, abs).replace(/\\/g, "/"),
        repo,
        title,
        body: raw,
        updated: new Date(st.mtimeMs).toISOString().slice(0, 10),
      });
      seen.add(abs);
    }
  };
  for (const r of docRoots()) walk(r.dir, r.repo);
  return docs;
}

function getDocsDb() {
  if (docsDb && Date.now() - docsBuiltAt < DOCS_TTL_MS) return docsDb;
  if (docsDb) {
    try {
      docsDb.close();
    } catch {
      /* ignore */
    }
  }
  const t0 = Date.now();
  const docs = collectDocs();
  const d = new DatabaseSync(":memory:");
  d.exec(
    "CREATE VIRTUAL TABLE docs_fts USING fts5(path, repo UNINDEXED, title, body, updated UNINDEXED, tokenize='unicode61 remove_diacritics 2');",
  );
  const insert = d.prepare(
    "INSERT INTO docs_fts (path, repo, title, body, updated) VALUES (?,?,?,?,?)",
  );
  d.exec("BEGIN");
  for (const doc of docs) {
    insert.run(doc.path, doc.repo, doc.title, doc.body, doc.updated);
  }
  d.exec("COMMIT");
  docsDb = d;
  docsBuiltAt = Date.now();
  docsStats = { count: docs.length, buildMs: docsBuiltAt - t0 };
  return docsDb;
}

function ftsTerms(text) {
  return [
    ...new Set(
      (
        String(text ?? "")
          .toLowerCase()
          .match(/[\p{L}\p{N}_-]{3,}/gu) ?? []
      ).slice(0, 12),
    ),
  ];
}

function queryDocs(match, repo, limit) {
  const d = getDocsDb();
  const params = [match];
  let sql = `SELECT path, repo, title, updated,
                    snippet(docs_fts, 3, '›', '‹', '…', 18) AS snippet,
                    bm25(docs_fts, 4.0, 0.0, 5.0, 1.0, 0.0) AS rank
               FROM docs_fts
              WHERE docs_fts MATCH ?`;
  if (repo) {
    sql += " AND repo = ?";
    params.push(repo);
  }
  sql += " ORDER BY rank LIMIT ?";
  params.push(limit);
  return d.prepare(sql).all(...params);
}

// Sinónimos de dominio: el usuario dice "contrato" y el spec se llama openapi/swagger.
const QUERY_SYNONYMS = {
  contrato: ["contrato", "contract", "openapi", "swagger"],
  contratos: ["contratos", "contract", "openapi", "swagger"],
  api: ["api", "openapi", "endpoint"],
};

function searchDocs(query, { repo = "", limit = 8 } = {}) {
  const terms = ftsTerms(query);
  if (!terms.length) return [];
  // Prefijo para términos >=4 letras: "cita"* también encuentra "citas".
  const quote = (t) => `"${t.replace(/"/g, '""')}"${t.length >= 4 ? "*" : ""}`;
  const groups = terms.map((t) => QUERY_SYNONYMS[t] ?? [t]);
  const groupQ = (op) =>
    groups.map((g) => `(${g.map(quote).join(" OR ")})`).join(` ${op} `);
  // primero AND (precisión); si no hay nada, OR (recall)
  let rows = queryDocs(groupQ("AND"), repo, limit);
  if (!rows.length) rows = queryDocs(groupQ("OR"), repo, limit);
  return rows;
}

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

let gdb;
function openGlobalDb() {
  if (gdb) return gdb;
  mkdirSync(GLOBAL_DIR, { recursive: true });
  gdb = new DatabaseSync(GLOBAL_DB_PATH);
  if (existsSync(SCHEMA_PATH)) gdb.exec(readFileSync(SCHEMA_PATH, "utf8"));
  gdb.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  return gdb;
}

function nowIso() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function nextId(type, store = openDb()) {
  const prefix =
    { lesson: "L", decision: "D", incident: "I", pattern: "P", handoff: "S" }[
      type
    ] ?? "X";
  const row = store
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

function writeKnowledgeFile(input, id, knowledgeRoot) {
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
  // raíz de knowledge: la del workspace, o la del store global (scope GLOBAL)
  const base = knowledgeRoot ?? path.join(WORKSPACE_ROOT, ".ai", "knowledge");
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(base, dir, `${date}-${slugify(title)}.md`);
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
    // el dir puede no existir aún (store global recién creado): crearlo siempre
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
    // actualizar índice del README del tipo (fila al final de la tabla si existe)
    const readmePath = path.join(base, dir, "README.md");
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
  // routing del store: scope GLOBAL → store de la máquina (visible desde cualquier proyecto);
  // los demás scopes → memoria local del workspace
  const useGlobal = scope === "GLOBAL";
  const d = useGlobal ? openGlobalDb() : openDb();
  const knowledgeRoot = useGlobal
    ? path.join(GLOBAL_DIR, "knowledge")
    : undefined;
  // project por defecto: nombre del workspace (sin hardcodear ningún producto)
  const projectName = project || path.basename(WORKSPACE_ROOT).toLowerCase();
  const id = nextId(type, d);
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
  writeKnowledgeFile(input, id, knowledgeRoot);
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
            .map((l) => l.trim())
            .filter(
              (l) =>
                l &&
                !l.startsWith("#") &&
                !/^\*\*(Fecha|Scope|Repos|Status|Evidencia|Tags):/.test(l),
            )
            .slice(0, 3)
            .join(" ")
            .slice(0, 220),
        });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function searchOneDb(
  store,
  query,
  { type = "", scope = "", repo = "", limit = 10 },
  isGlobal,
) {
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
  // el filtro por repo sólo aplica al store local: los hits globales vienen
  // de OTROS proyectos y su repo no es comparable
  if (repo && !isGlobal) {
    sql += " AND (m.repo LIKE ? OR m.repo = 'workspace')";
    params.push(`%${repo}%`);
  }
  sql += " ORDER BY rank LIMIT ?";
  params.push(limit);
  return store.prepare(sql).all(...params);
}

function searchMemory(
  query,
  { scope = "", repo = "", type = "", limit = 10 } = {},
) {
  const hits = searchOneDb(
    openDb(),
    query,
    { type, scope, repo, limit },
    false,
  );
  // store global de la máquina: conocimiento cross-proyecto (si ya existe)
  if (existsSync(GLOBAL_DB_PATH)) {
    const gHits = searchOneDb(
      openGlobalDb(),
      query,
      { type, scope: "", repo: "", limit },
      true,
    ).map((r) => ({ ...r, fromGlobal: true }));
    return [...hits, ...gHits].sort((a, b) => a.rank - b.rank).slice(0, limit);
  }
  return hits;
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
// Ningún tool debe volcar un doc canónico completo: el contexto se paga por token.
function capText(text, limit = 8000, hint = "") {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[… truncado: ${text.length} chars${hint ? `; ${hint}` : ""}]`;
}

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
  // Preámbulo = últimos cambios (entradas más recientes antes del primer ##).
  const preamble = overview
    .split(/^## /m)[0]
    .replace(/^#\s+.*$/m, "")
    .trim();
  // primeras secciones del doc canónico, recortadas por sección (progressive disclosure).
  // No volcar 80 KB de estado: el detalle se pide con read_doc/offset.
  const sections = overview
    .split(/^## /m)
    .slice(1, 4)
    .map((s) => {
      const [head, ...body] = s.trimEnd().split("\n");
      return `## ${head.trim()}\n${body.join("\n").slice(0, 1400)}`;
    })
    .join("\n\n");
  return capText(
    [
      `## Workspace ${path.basename(WORKSPACE_ROOT)} — Overview`,
      "",
      "Resumen mínimo; el detalle va bajo demanda (read_doc / search_knowledge).",
      "",
      ...(preamble ? ["### Últimos cambios", preamble.slice(0, 1800), ""] : []),
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
      "- `context_brief(task)` — arranque compacto: router + docs + knowledge + open items",
      "- `search_docs(query)` — FTS sobre docs/, openspec/ y <repo>/docs/ de todos los repos",
      "- PROJECTS.md (mapa de repos/puertos) · ROUTER.md (tarea→repos) · AGENT-MATRIX.md (agente según tarea) · OPEN-ITEMS.md (backlog)",
      "- knowledge/{decisions,lessons,incidents,patterns}/ · playbooks/",
    ].join("\n"),
    8000,
    'usa read_doc(file=".ai/workspace/OVERVIEW.md", offset=8000)',
  );
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
  return capText(
    `# Contexto: ${dir}\n\n${agents}\n\n### Memoria relacionada\n${kb || "sin entradas"}`,
    8000,
    `usa read_doc(file="${dir}/AGENTS.md") para el detalle`,
  );
}

function toolGetCurrentState({ limit = 24000 } = {}) {
  const raw = readWs("OVERVIEW.md");
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit)}\n\n[… OVERVIEW truncado: ${raw.length} chars; usa read_doc(file=".ai/workspace/OVERVIEW.md", offset=${limit})]`;
}
function toolGetOpenTasks({ limit = 8000 } = {}) {
  const items = path.join(WORKSPACE_ROOT, ".ai", "workspace", "OPEN-ITEMS.md");
  if (!existsSync(items)) return "sin OPEN-ITEMS.md";
  const raw = readFileSync(items, "utf8");
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit)}\n\n[… OPEN-ITEMS truncado: ${raw.length} chars; usa read_doc(file=".ai/workspace/OPEN-ITEMS.md", offset=${limit})]`;
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
  return capText(
    parts.join("\n\n") || "sin entradas",
    8000,
    `usa read_doc(file=".ai/knowledge/${dir}s/<fichero>")`,
  );
}
function toolGetDoc(file, { offset = 0, limit = 12000 } = {}) {
  if (!file)
    return "⚠️ falta el argumento { file: \"ruta/relativa\" } — ej: file='openspec/changes/<cambio>/proposal.md'";
  const rel = String(file)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .trim();
  if (!rel || path.isAbsolute(rel) || rel.split("/").includes(".."))
    return "⚠️ ruta inválida: usa una ruta relativa al workspace, sin `..`.";
  const parts = rel.split("/");
  const first = parts[0];
  const allowed =
    rel === "AGENTS.md" ||
    [".ai", "openspec", "docs"].includes(first) ||
    (parts.length >= 2 && (parts[1] === "docs" || parts[1] === "AGENTS.md"));
  if (!allowed)
    return "⚠️ read_doc solo permite .ai/, openspec/, docs/, <repo>/docs/ y <repo>/AGENTS.md.";
  if (parts.some((s) => DOC_SKIP_SEGMENTS.has(s)))
    return "⚠️ ruta excluida (node_modules, .git, .worktrees, archive, build, dist...).";
  if (!/\.(mdx?|txt|json|ya?ml)$/i.test(rel))
    return "⚠️ extensión no permitida (md, mdx, txt, json, yaml, yml).";
  const abs = path.resolve(WORKSPACE_ROOT, rel);
  if (!existsSync(abs)) return `⚠️ fichero no encontrado: ${rel}`;
  let real;
  try {
    real = realpathSync(abs);
  } catch {
    return `⚠️ no se pudo resolver la ruta: ${rel}`;
  }
  const realRel = path.relative(WORKSPACE_ROOT, real).replace(/\\/g, "/");
  if (realRel.startsWith("..") || path.isAbsolute(realRel))
    return "⚠️ la ruta resuelta queda fuera del workspace.";
  let raw;
  try {
    raw = readFileSync(real, "utf8").replace(/^\uFEFF/, "");
  } catch (e) {
    return `⚠️ no se pudo leer ${rel}: ${e.message}`;
  }
  const off = Math.max(0, Number(offset) || 0);
  const max = Math.min(Math.max(Number(limit) || 12000, 1000), 60000);
  const chunk = raw.slice(off, off + max);
  const truncated = raw.length > off + max;
  return `${chunk}${
    truncated
      ? `\n\n[… truncado: ${raw.length} chars; usa offset=${off + max}]`
      : ""
  }`;
}

function toolSearchDocs({ query = "", repo = "", limit = 8 } = {}) {
  if (!query.trim()) return "⚠️ falta el argumento `query`.";
  try {
    getDocsDb();
    const hits = searchDocs(query, {
      repo,
      limit: Math.min(Math.max(Number(limit) || 8, 1), 20),
    });
    if (!hits.length)
      return `Sin resultados para "${query}" en ${docsStats.count} docs indexados (${docsStats.buildMs} ms). Prueba términos más cortos o \`search_knowledge\`.`;
    return [
      `## Docs — "${query}" (${hits.length}/${docsStats.count})`,
      ...hits.map(
        (h) => `- ${h.path} (${h.updated}) :: ${h.title}\n  ${h.snippet}`,
      ),
      "",
      'Detalle: `read_doc(file="...")` solo en los 2-3 con más señal.',
    ].join("\n");
  } catch (e) {
    return `⚠️ índice de docs no disponible: ${e.message}`;
  }
}

function toolContextBrief({ task = "", repo = "" } = {}) {
  if (!task.trim()) return "⚠️ falta el argumento `task`.";
  const routed = routeTask(task);
  const terms = ftsTerms(task);

  // Knowledge: memoria + ficheros canónicos, deduplicado por título.
  const seen = new Set();
  const knowledge = [];
  for (const r of [
    ...searchMemory(task, { limit: 8 }),
    ...scanKnowledgeFiles(task, { limit: 8 }),
  ]) {
    const key = (r.title || r.id || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    knowledge.push(r);
    if (knowledge.length >= 6) break;
  }

  // Docs: no filtrar por repo del router (telemedicine no es un directorio);
  // el ranking FTS ya prioriza los términos de la tarea.
  let docs = [];
  try {
    docs = searchDocs(task, { repo, limit: 7 });
  } catch {
    docs = [];
  }

  // Open items: bloques de OPEN-ITEMS.md que comparten términos con la tarea.
  const open = [];
  const openPath = path.join(WS_DIR, "OPEN-ITEMS.md");
  if (existsSync(openPath)) {
    for (const block of readFileSync(openPath, "utf8").split(/\n\s*\n/)) {
      const text = block.trim();
      if (!text || text.startsWith("#")) continue;
      const low = text.toLowerCase();
      const score = terms.reduce((n, t) => n + (low.includes(t) ? 1 : 0), 0);
      if (score > 0) open.push({ text, score });
    }
    open.sort((a, b) => b.score - a.score);
  }

  const lines = [
    `# Brief — ${task}`,
    "",
    "## Repos (router)",
    ...(routed.repos.length
      ? routed.repos.map((r) => `- ${r}`)
      : ["- sin clasificar"]),
    "",
  ];
  if (docs.length) {
    lines.push(`## Docs (${docs.length}/${docsStats.count})`);
    for (const d of docs)
      lines.push(`- ${d.path} (${d.updated}) :: ${d.title}`, `  ${d.snippet}`);
    lines.push("");
  }
  if (knowledge.length) {
    lines.push("## Knowledge");
    for (const k of knowledge)
      lines.push(
        `- ${k.id} [${k.type}] ${k.title}`,
        `  ${(k.snippet || "").slice(0, 220)}`,
      );
    lines.push("");
  }
  if (open.length) {
    lines.push("## Open items");
    for (const o of open.slice(0, 4))
      lines.push(`- ${o.text.replace(/\s+/g, " ").slice(0, 260)}`);
    lines.push("");
  }
  lines.push(
    "## Siguiente paso",
    '- Abre solo los 2-3 docs con más señal: `read_doc(file="...")`.',
    "- Para código: `codegraph_explore` (no grep+read en cadena).",
  );
  const out = lines.join("\n");
  return out.length > 16000
    ? `${out.slice(0, 16000)}\n… (brief truncado)`
    : out;
}

function toolHealth() {
  const d = openDb();
  const total = d.prepare("SELECT COUNT(*) c FROM memory").get().c;
  const stale = d
    .prepare(
      "SELECT COUNT(*) c FROM memory WHERE updated_at < datetime('now','-60 days')",
    )
    .get().c;
  let globalPart = "";
  if (existsSync(GLOBAL_DB_PATH)) {
    const gt = openGlobalDb().prepare("SELECT COUNT(*) c FROM memory").get().c;
    globalPart = ` · global cross-proyecto: ${gt} entradas (${GLOBAL_DIR})`;
  }
  const docsPart = docsBuiltAt
    ? ` · docs indexados: ${docsStats.count} (${docsStats.buildMs} ms)`
    : " · docs: aún sin indexar (lazy)";
  return `memory.db OK · ${total} entradas · ${stale} sin tocar hace >60d · WAL activo${globalPart}${docsPart}`;
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
    "Búsqueda híbrida: FTS de memoria local + store global cross-proyecto + escaneo vivo de .ai/knowledge (siempre fresco). Los hits [global] vienen de ~/.ai-workspace/global/.",
    (a) => {
      const dbHits = searchMemory(a.query, a).map(
        (r) =>
          `${r.fromGlobal ? "[global] " : ""}${r.id} [${r.type}/${r.scope}] ${r.title}\n  ${r.snippet}`,
      );
      const fileHits = scanKnowledgeFiles(a.query, a).map(
        (r) => `${r.id} [${r.type}] ${r.title}\n  ${r.snippet}`,
      );
      const all = [...dbHits, ...fileHits];
      return all.join("\n\n") || "sin resultados";
    },
  ],
  [
    "search_docs",
    "Busca en Markdown de docs/, openspec/, <repo>/docs/ y .ai/ (FTS5 en memoria). Devuelve path+fecha+título+snippet; usa read_doc solo para el detalle.",
    (a) => toolSearchDocs(a),
  ],
  [
    "context_brief",
    "Brief de arranque para una tarea: router de repos + docs + knowledge + open items. Úsalo tras workspace_overview para no leer ficheros a ciegas.",
    (a) => toolContextBrief(a),
  ],
  [
    "get_current_state",
    "Estado por módulo con evidencia (OVERVIEW.md; cap 24k chars, usa read_doc offset para más).",
    (a) => toolGetCurrentState(a),
  ],
  [
    "get_decisions",
    "Índice de decisiones (ADRs).",
    () => toolGetKnowledge("decision"),
  ],
  ["get_lessons", "Índice de lessons.", () => toolGetKnowledge("lesson")],
  ["get_incidents", "Índice de incidents.", () => toolGetKnowledge("incident")],
  [
    "get_open_tasks",
    "Backlog vivo OPEN-ITEMS.md (cap 8k chars; usa read_doc offset para el resto).",
    (a) => toolGetOpenTasks(a),
  ],
  [
    "get_dependencies",
    "Router: repos+docs involucrados según texto de tarea.",
    (a) => JSON.stringify(routeTask(a.task), null, 1),
  ],
  [
    "read_doc",
    "Lee un doc bajo demanda (md/mdx/txt/json/yaml) de .ai/, openspec/, docs/ o <repo>/docs|AGENTS.md. Args: `file`, opcional `offset`/`limit` (default 12000 chars). No lee node_modules/.worktrees/archive.",
    (a) => toolGetDoc(a.file, a),
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
  [
    "memory_health",
    "Salud de la memoria (local + store global cross-proyecto).",
    () => toolHealth(),
  ],
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
        serverInfo: { name: "context-broker", version: "1.1.0" },
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
              offset: { type: "integer" },
              limit: { type: "integer" },
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
    docs: () => toolSearchDocs({ query: args.join(" "), limit: 12 }),
    brief: () => toolContextBrief({ task: args.join(" ") }),
    read: () => toolGetDoc(args[0] ?? "", { limit: 20000 }),
    overview: toolOverview,
    router: () => JSON.stringify(routeTask(args.join(" ")), null, 1),
    health: toolHealth,
    seed: () => {
      openDb();
      return "schema aplicado";
    },
  }[cmd];
  console.log(
    out
      ? out()
      : `comandos: search|docs|brief|read|overview|router|health|seed`,
  );
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
