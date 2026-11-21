#!/usr/bin/env node
/**
 * context-eval.mjs — eval mínima de recuperación de contexto.
 *
 * Mide hit@3/hit@7 de `search_docs` y presencia del doc/lesson esperado en `context_brief`.
 * No usa LLM: solo verifica que el retrieval devuelve la fuente correcta.
 * Sirve para detectar regresiones al tocar ROUTER, docs o ranking FTS.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const BROKER = path.join(ROOT, ".ai", "broker", "broker.mjs");

const docCases = [
  {
    q: "disponibilidad citas",
    expect: "openspec/specs/telemedicine/appointments-availability/spec.md",
  },
  {
    q: "recibos whatsapp",
    expect: "coppAddresdBack/docs/modules/whatsapp/README.md",
  },
  {
    q: "contrato openapi vita",
    expect: "ai-service/docs/contracts/vita-ai.openapi.json",
  },
  {
    q: "plan nutricional erp",
    expect: "openspec/changes/plan-nutricional-erp/proposal.md",
  },
  {
    q: "historial mensual vita",
    expect: "ai-service/docs/vita-history.md",
  },
  {
    q: "separacion cuentas erp pacientes",
    expect: ".ai/operations/2026-11-20-users-pacientes/REPORTE.md",
    expectAny: [
      ".ai/operations/2026-11-20-users-pacientes/ENTREGA.md",
      ".ai/operations/2026-11-20-users-pacientes/BRIEF.md",
    ],
  },
  {
    q: "auditoria erp",
    expect: "coppaddresd-front/docs/erp-phase-01-review.md",
    expectAny: [
      "coppAddresdBack/docs/modules/audit/README.md",
      "openspec/changes/organizar-experiencia-bienestar/revision-2.21-front/AUDITORIA-UI.md",
    ],
  },
  {
    q: "vita omnicanal",
    expect: "openspec/changes/vita-omnicanal-2026-11/proposal.md",
  },
];

const briefCases = [
  {
    q: "whatsapp recibos",
    expect: "coppAddresdBack/docs/modules/whatsapp/README.md",
  },
  {
    q: "N+1 availability",
    expect: "citas-availability-rango",
  },
  {
    q: "WAF Panama",
    expect: "waf-geo-bloqueo-app",
  },
  {
    q: "separacion cuentas erp pacientes",
    expect: ".ai/operations/2026-11-20-users-pacientes/REPORTE.md",
    expectAny: [
      ".ai/operations/2026-11-20-users-pacientes/ENTREGA.md",
      ".ai/operations/2026-11-20-users-pacientes/BRIEF.md",
    ],
  },
  {
    q: "openapi contrato",
    expect: "ai-service/docs/contracts/vita-ai.openapi.json",
  },
];

function run(cmd, q) {
  const t0 = Date.now();
  const out = execFileSync(
    process.execPath,
    ["--no-warnings", BROKER, cmd, q],
    { cwd: ROOT, encoding: "utf8", timeout: 30000 },
  );
  return { out, ms: Date.now() - t0 };
}

function docPaths(out) {
  return out
    .split("\n")
    .map((l) => l.match(/^- (\S+) \(/)?.[1])
    .filter(Boolean);
}

function expected(c) {
  return [c.expect, ...(c.expectAny ?? [])];
}

function matches(text, c) {
  return expected(c).some((e) => text.includes(e));
}

let docHits3 = 0;
let docHits7 = 0;
let totalMs = 0;
let totalChars = 0;

console.log("## Eval de retrieval\n");
console.log("### search_docs");
for (const c of docCases) {
  const { out, ms } = run("docs", c.q);
  const paths = docPaths(out);
  const idx = paths.findIndex((p) => matches(p, c));
  const hit3 = idx >= 0 && idx < 3;
  const hit7 = idx >= 0 && idx < 7;
  if (hit3) docHits3++;
  if (hit7) docHits7++;
  totalMs += ms;
  totalChars += out.length;
  console.log(
    `${hit3 ? "HIT@3" : hit7 ? "HIT@7" : "MISS "} ${c.q} -> ` +
      (idx >= 0 ? `${idx + 1}. ${paths[idx]}` : `esperado: ${c.expect}`),
  );
  if (!hit7)
    console.log(
      `  top3: ${paths.slice(0, 3).join(" | ") || "(sin resultados)"}`,
    );
}

console.log("\n### context_brief");
let briefHits = 0;
for (const c of briefCases) {
  const { out, ms } = run("brief", c.q);
  totalMs += ms;
  totalChars += out.length;
  const ok = matches(out, c);
  if (ok) briefHits++;
  console.log(
    `${ok ? "HIT " : "MISS"} ${c.q} -> ${ok ? expected(c).find((e) => out.includes(e)) : "no aparece " + c.expect}`,
  );
}

const n = docCases.length + briefCases.length;
console.log("\n### Resumen");
console.log(
  `docs hit@3: ${docHits3}/${docCases.length} · hit@7: ${docHits7}/${docCases.length} · ` +
    `brief: ${briefHits}/${briefCases.length}`,
);
console.log(
  `media: ${Math.round(totalMs / n)} ms/caso · ${Math.round(totalChars / n)} chars/caso`,
);
