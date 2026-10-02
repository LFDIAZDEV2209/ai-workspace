# Prompts listos para copiar y pegar

> Todos asumen el MCP `context-broker` conectado. Si aún no lo instalaste:
> [README · Instalación](../README.md#-instalación-en-30-segundos).

## 1. Arranque frío (primera sesión del día)

```text
Usa el sistema .ai/: preséntame el workspace en 10 líneas (repos, estado, riesgos,
tarea más urgente). Nada de leer ficheros completos: solo el overview y lo estricto.
```

## 2. ¿Qué repos toca esta tarea?

```text
Con get_dependencies clasifica esta tarea y dame los repos + por qué:
"<TU TAREA AQUÍ>"
Si la clasificación parece incompleta, muéstrame la tabla de ROUTER.md y propón la fila nueva.
```

## 3. Registro de decisión (durante el trabajo)

```text
Registra esta decisión en el sistema: [título] | [cuerpo con la alternativa descartada
y por qué] | repos afectados. Usa record_decision. Si reemplaza una decisión anterior,
indica supersedes y márcala.
```

## 4. Registro de lección (cuando algo se aprenda por las malas)

```text
Registra esta lesson: [título] | [qué pasó, causa raíz, implicación general] | evidencia:
[commit/fichero]. Usa record_lesson.
```

## 5. Cierre de sesión (obligatorio al terminar)

```text
Cierra la sesión: ejecuta node .ai/scripts/session-close.mjs con un resumen de lo hecho,
los commits y los repos. Después completa su checklist: OVERVIEW.md si cambió el estado,
OPEN-ITEMS.md con lo pendiente, índices de knowledge al día, git status limpio y panes
de Herdr cerrados.
```

## 6. Auditoría de salud del sistema

```text
Ejecuta node .ai/scripts/doc-health.mjs y muéstrame el resultado. Para cada hallazgo
propón la acción concreta (archivar, consolidar, indexar) y espera mi aprobación
antes de tocar ficheros.
```

## 7. Memoria: búsqueda antes de rehacer trabajo

```text
Antes de implementar "<feature>": busca en la memoria y knowledge con search_knowledge
"<keywords>". Muéstrame decisiones/lessons/incidents relacionados y dime si algo cambia
mi plan. Si no hay nada registrado, dímelo — no asumas que no existe.
```

## 8. Handoff para continuar mañana

```text
Voy a cerrar por hoy. Registra el handoff con: qué está hecho, qué queda a medias,
dónde quedó (ficheros/ramas), y qué debo decirte mañana para continuar sin repetir nada.
```

## 9. Onboarding de un compañero nuevo (o su agente)

```text
Acaba de unirse un dev. Explícale el workspace en 5 minutos usando solo el sistema .ai/:
qué es cada repo, cómo correr el stack, cuáles son las reglas que no se rompen y dónde
vive cada tipo de información. Genera el resumen como para compartir.
```

## 10. Organizar documentación legacy (caso 2 completo)

```text
Sigue el CASO 2 de docs/USE-CASES.md: inventario completo de mi documentación
(tabla con ruta/tamaño/fecha/tipo/duplicados), mi aprobación, y luego consolidación
a canónicos + archive sin borrados destructivos.
```
