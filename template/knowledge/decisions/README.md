# Knowledge — Decisiones (ADRs compactos)

Formato por fichero: `<fecha>-<slug>.md` con frontmatter mínimo.
Sólo decisiones que cambian comportamiento del sistema, su arquitectura o su proceso.
Decisiones de un solo módulo viven en `docs/` del repo correspondiente.

## Índice

| ID  | Fecha | Decisión | Estado |
| --- | ----- | -------- | ------ |

## Ficheros

Reglas:

- Nueva decisión = nuevo fichero `YYYY-MM-DD-slug.md` + fila en índice.
- Decisión que reemplaza a otra: campo `supersedes: 000X` y marca la anterior `superseded`.
- Nunca reescribas una decisión antigua: su historial es valioso.
