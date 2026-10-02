# Playbook QA — Verificación de calidad por repo

> Nunca declare una tarea como terminada sin build + tests + lint del proyecto afectado.

## Tabla por repo (rellenar por proyecto)

| Repo     | Build | Tests | Lint | E2E |
| -------- | ----- | ----- | ---- | --- |
| `<repo>` | ...   | ...   | ...  | ... |

## QA visual (UI)

1. Capturar pantalla con Playwright MCP tras el cambio.
2. Revisión visual (subagent reviewer / vision-reviewer): P0/P1/P2 + a11y WCAG 2.2 AA + responsive.
3. Capturas aprobadas → adjuntar al change/ticket.

## QA integración (backend multi-servicio)

1. Arrancar entorno con los scripts del proyecto (siempre background).
2. Verificar por HTTP cada servicio; nunca asumir que arrancó.
3. NO dejar servidores en foreground.

## Antes de commit

- [ ] build pasa en repos afectados
- [ ] tests afectados pasan
- [ ] i18n (si aplica) no rompe keys
- [ ] docs canónicas actualizadas (OVERVIEW / lessons)
