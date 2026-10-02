# Playbook — Onboarding de agente nuevo (cold-start)

> Para cualquier agente que entre al workspace sin contexto previo.
> Puntos 1-3 son OBLIGATORIOS (≤2 min). Puntos 4+ solo si la tarea lo exige.

## 1. Lee `.ai/workspace/OVERVIEW.md`

Estado actual del workspace con evidencia. No preguntes "¿qué está hecho?" — está ahí.

## 2. Lee `.ai/workspace/PROJECTS.md`

Mapa de repos, puertos, gateway, schemas, reglas operativas duras.

## 3. Si tu tarea toca código: lee el `AGENTS.md` del repo afectado

No leas los de repos que NO vas a tocar.

## 4. ¿Tu tarea ya tiene spec? Busca en `openspec/` (si existe)

```powershell
openspec list
Get-Content openspec\changes\<nombre>\proposal.md
```

Si existe spec y tu tarea pertenece a ella: no propongas nada nuevo, aplica.

## 5. Si necesitas historia/decisiones/aprendizajes

- Decisiones: `.ai/knowledge/decisions/` · Lessons: `.ai/knowledge/lessons/`
- Incidents: `.ai/knowledge/incidents/` · Patterns: `.ai/knowledge/patterns/`
- O vía broker: `search_knowledge` / CLI `node .ai/broker/broker.mjs search "<keywords>"`

## 6. Antes de terminar la sesión (OBLIGATORIO para agentes que escriben)

Ejecuta `node .ai/scripts/session-close.mjs` — guía para consolidar decisiones/lessons/handoff.
Subagentes internos de solo lectura: exentos (consolida el orquestador).

## Reglas de comportamiento

- Preguntas al dueño con opciones recomendadas; nunca asumas si es ambiguo.
- Herdr para paralelizar (playbook `herdr.md`) si está instalado.
- OpenSpec (si existe) para feature no trivial (exención: typos/copys/config local/fix una línea).
- Skills first: carga skills del repo antes de escribir código de ese dominio.
- CodeGraph first para exploración de código (si está instalado).
