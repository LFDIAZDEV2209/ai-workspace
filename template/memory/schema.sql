-- Schema de memoria del workspace (Sistema .ai/)
-- SQLite 3 + FTS5 (node:sqlite, zero deps). Toda entrada con metadata.

CREATE TABLE IF NOT EXISTS memory (
  id          TEXT PRIMARY KEY,                       -- L0001, D0001, I0001, P0001
  type        TEXT NOT NULL CHECK(type IN ('lesson','decision','incident','pattern','handoff')),
  scope       TEXT NOT NULL CHECK(scope IN ('GLOBAL','WORKSPACE','PROJECT','SESSION','EPHEMERAL')),
  project     TEXT NOT NULL,                          -- por defecto: nombre del workspace
  repo        TEXT,                                   -- repo(s) afectados, CSV
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','retired')),
  source      TEXT,                                   -- fichero origen / doc canónica
  commit_sha  TEXT,
  confidence  TEXT NOT NULL DEFAULT 'verified' CHECK(confidence IN ('verified','probable','historical')),
  supersedes  TEXT,
  tags        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_type   ON memory(type);
CREATE INDEX IF NOT EXISTS idx_memory_scope  ON memory(scope);
CREATE INDEX IF NOT EXISTS idx_memory_repo   ON memory(repo);
CREATE INDEX IF NOT EXISTS idx_memory_status ON memory(status);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  title, body, tags,
  content='memory', content_rowid='rowid'
);

-- triggers de sincronización FTS
CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, body, tags) VALUES ('delete', old.rowid, old.title, old.body, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, body, tags) VALUES ('delete', old.rowid, old.title, old.body, old.tags);
  INSERT INTO memory_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
END;

-- índice de documentos canónicos (para search_knowledge: no indexa contenido, solo ruta+estado)
CREATE TABLE IF NOT EXISTS docs (
  path      TEXT PRIMARY KEY,        -- relativo a Repos/
  repo      TEXT,                    -- workspace | <nombre-del-repo> | ...
  kind      TEXT NOT NULL CHECK(kind IN ('canonico','historico','prompt','handoff','runbook','spec')),
  title     TEXT,
  status    TEXT NOT NULL DEFAULT 'vigente' CHECK(status IN ('vigente','stale','archivado')),
  updated_at TEXT NOT NULL
);
