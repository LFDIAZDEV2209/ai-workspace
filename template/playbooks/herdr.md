# Playbook Herdr — Orquestación de agentes

> Única fuente operativa de Herdr en este workspace. Ajustar roles/nombres al proyecto.

## Comandos base

```powershell
herdr pane split --no-focus                   # crea un pane vacío (no roba el foco)
herdr agent start <nombre> --kind opencode|codex|agy --pane <id>
herdr agent prompt <nombre> "instrucción..." --wait --until idle|done --timeout 120000
herdr agent read <nombre> --source recent-unwrapped
herdr agent wait <nombre> --until blocked|idle
herdr agent list                              # estado de todos los panes
herdr pane list
herdr agent close <nombre>
herdr agent focus <nombre>
```

> Kinds disponibles según integración instalada (opencode/codex/agy). Verifica con `herdr agent explain`.

## Roles tipados (personalizar por proyecto)

| Nombre de pane | Kind     | Responsabilidad                                                    |
| -------------- | -------- | ------------------------------------------------------------------ |
| `planner`      | agy      | produce `proposal.md` + `tasks.md` en `openspec/changes/<nombre>/` |
| `reviewer`     | codex    | review del plan/espec, validación técnica                          |
| `executor-*`   | opencode | implementa en su repo (back/front/app/...)                         |
| `qa`           | opencode | E2E con playwright MCP; capturas para revisión visual              |

## Reglas de orquestación (NUNCA romper)

1. **Nunca pegues prompts multilínea en el TUI**: ConPTY los fragmenta. Usa `herdr agent prompt <nombre>`.
2. **Nunca promptees un agente en estado `blocked`**: espera con `herdr agent wait`; aprobaciones al humano.
3. **Prohibido usar subagentes internos como ejecutores paralelos duraderos**: se crean en Herdr con nombre visible.
4. Aprobaciones mecánicas se responden con `herdr agent send-keys`.
5. Rescata outputs largos con `agent read --source recent-unwrapped` ANTES de cerrar el pane.
6. Herdr es capa de orquestación, **no** memoria principal. El conocimiento vive en `.ai/` y openspec.
7. Cada sesión cierra sus panes o los deja documentados en `OVERVIEW.md` (misión activa).
