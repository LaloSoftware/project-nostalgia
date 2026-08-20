# ADR 0009 — Modelo de ramas y publicación del repositorio

**Estado:** aceptada — 2026-08-19, al integrar el proyecto a git por primera vez

## Contexto

Hasta esta fecha el proyecto **no estaba versionado**. El directorio tenía un `.git`
inicializado con una rama `dev` que jamás recibió un commit: `git log` fallaba con
`your current branch 'dev' does not have any commits yet`, no había remoto configurado, y
los 87 archivos del proyecto existían únicamente como archivos sin rastrear en un solo disco.

Eso significaba que las Fases 0, A, B y C completas —incluidos los ocho ADRs que son la fuente
de verdad sobre por qué el proyecto es como es— dependían de que un MacBook no fallara. No
había forma de responder "¿qué cambió entre que MilkDrop no funcionaba y que sí?", ni de
volver a un estado anterior, ni de que nadie más leyera nada.

La decisión a tomar no era "usar git" (eso no está en discusión) sino **qué forma darle al
historial y a las ramas**, dado que el punto de partida es un proyecto maduro con cero commits
y un remoto vacío.

## Estado verificado antes de decidir

| Hecho | Valor |
|---|---|
| Commits existentes | 0 |
| Remoto `LaloSoftware/project-nostalgia` | existe y responde, **0 refs** (`git ls-remote` vacío) |
| Archivos a versionar | 87 (+ el `.gitignore` de raíz creado en el proceso) |

Como el remoto estaba literalmente vacío, ninguna operación podía sobrescribir trabajo ajeno.
Eso permitió construir el historial con libertad total, una sola vez, sin `--force` sobre nada.

## Decisión

Dos ramas de larga vida, ambas descendientes de un mismo commit raíz vacío:

```
main     ● raíz vacía   ← reservada para estados publicables; rama por defecto
         │
develop  ●──●──●──●──●──●   ← todo el trabajo
```

- **`main`** contiene un único commit vacío (`git commit --allow-empty`) y **cero archivos**
  (`git ls-tree -r main` no devuelve nada). Queda reservada para estados que compilen y se
  puedan empaquetar; el trabajo llega ahí por merge desde `develop`, nunca por commit directo.
- **`develop`** es la rama de trabajo y contiene el proyecto completo.
- La rama `dev` original desapareció por sí sola al crear `main`: una rama sin nacer (sin
  ningún commit) no es una referencia real, así que no hubo nada que borrar.

### Por qué `main` vacía y no inexistente

Git **no puede crear una rama sin al menos un commit**. "`main` limpia" no es un estado que
git sepa representar; la aproximación más cercana es un commit sin árbol de archivos. El costo
es un artefacto permanente en el historial —un commit que no contiene nada— y el beneficio es
que `develop` desciende de `main`, de modo que el futuro merge `develop → main` es un merge
ordinario y su diff es, literalmente, el proyecto entero.

## Alternativas consideradas y por qué se descartaron

### Un solo commit inicial con los 87 archivos

Lo más honesto en un sentido estricto: el historial no fingiría una progresión que en git no
ocurrió. Se descartó porque `git log` no diría nada sobre la estructura del proyecto, y en un
repositorio cuyo valor declarado es que un lector entienda el porqué (CLAUDE.md), un único
`Initial commit` de 87 archivos desperdicia el primer lugar donde ese lector va a mirar.

**Se eligió en su lugar:** cinco commits temáticos sobre `develop` —directivas, documentación,
andamiaje, motor de audio, frontend y carátulas— con mensajes que explican el porqué y remiten
a los ADRs correspondientes.

### `main` como rama huérfana (`git checkout --orphan`)

Daría una `main` vacía sin el commit-artefacto. Se descartó porque `main` y `develop` no
compartirían ancestro, y todo merge entre ellas exigiría `--allow-unrelated-histories` **para
siempre**. Se cambió un commit vacío permanente por una fricción permanente mucho peor.

### Trunk-based: una sola rama

Sin `develop`, todo directo a `main`. Es defendible para un proyecto de un solo desarrollador y
elimina una rama que mantener. Se descartó por una razón concreta de este proyecto: de `main`
se producen los instaladores. `docs/guias/build-y-empaquetado.md` documenta un build universal
(`x86_64` + `aarch64`) y un `.dmg` que ya requirió resolver un timeout de AppleScript en
entorno headless — un pipeline con suficientes aristas para no querer dispararlo desde una rama
que puede estar a medias. Que `main` sea siempre publicable tiene valor operativo real aquí.

### git-flow completo (`release/*`, `hotfix/*`, `feature/*`)

Se descartó por desproporción: un desarrollador, sin releases coordinados ni versiones
mantenidas en paralelo. Las ramas de `release` existen para estabilizar mientras el desarrollo
sigue en otra parte, y aquí no hay dos frentes simultáneos que estabilizar. Sería burocracia
sin beneficio.

## Números concretos

Lo que decide qué entra y qué no al repositorio es una diferencia de tres órdenes de magnitud:

| Contenido | Tamaño | ¿Versionado? |
|---|---|---|
| Los 88 archivos del proyecto | **1,1 MB** | sí |
| `app/src-tauri/target/` (artefactos de Cargo) | **4,9 GB** | no |
| `app/node_modules/` | **172 MB** | no |
| `app/dist/` (build de Vite) | 1,0 MB | no |
| `app/src-tauri/gen/` (esquemas generados por Tauri) | 304 KB | no |

El árbol versionado es **~4 700 veces más pequeño** que el `target/` de Cargo que queda fuera.
De ese 1,1 MB, **532 KB son los iconos** de la aplicación (`.icns`, `.ico` y los PNG de todas
las resoluciones que exigen macOS y Windows) — es decir, casi la mitad del peso del repositorio
son binarios que no cambiarán casi nunca. El código y la documentación juntos pesan menos que
los iconos.

El `.git` resultante tras los seis primeros commits: **1,1 MB**, 124 objetos.

Los dos lockfiles suman **6 001 líneas** (`Cargo.lock` 4 964, `pnpm-lock.yaml` 1 037) y ambos
se versionan a propósito — es la mitad del punto del ADR 0007.

### Exclusiones: dónde viven las reglas

El `.gitignore` de la raíz se creó deliberadamente **mínimo** (solo `.DS_Store` y directorios
de editores). `app/.gitignore` y `app/src-tauri/.gitignore` ya declaraban lo suyo, y
centralizar todo en la raíz rompería la separación de dominios de CLAUDE.md: cada subárbol es
dueño de sus propias exclusiones. Verificado con `git add -An` antes del primer commit y con
`git ls-files | grep` después: ni un archivo de `node_modules`, `target`, `dist` o
`gen/schemas` entró al historial.

## Riesgos conocidos y consecuencias asumidas

- **La portada de GitHub estará en blanco.** Como `main` es la rama por defecto y no tiene
  archivos, quien llegue al repositorio no verá ni un README hasta el primer merge de
  `develop`. Es el precio directo de haber pedido `main` limpia, y es reversible en cualquier
  momento.
- **El commit vacío es permanente.** Reescribirlo después implicaría reescribir todo el
  historial (`rebase --root`) y forzar el push sobre las dos ramas.
- **Los lockfiles versionados generan conflictos de merge más frecuentes** que si estuvieran
  ignorados. Se acepta: la reproducibilidad exacta de la cadena de suministro vale más que la
  comodidad del merge (ADR 0007).
- **El email del autor queda público y permanente.** Los commits se firman con
  `eduardo.lemus.laguna@gmail.com`, configurado con `git config --local` para no alterar la
  configuración global de la máquina. La alternativa era la dirección `noreply` de GitHub, que
  atribuye igual pero no expone el correo; se eligió el email real conscientemente. Cambiarlo
  a posteriori exige reescribir el historial.
- **`develop` no está protegida.** Un `push --force` accidental sobre ella sí puede perder
  trabajo, ahora que el remoto ya no está vacío.

## Qué se sacrificó

**El historial no refleja la cronología real del desarrollo.** Las Fases 0, A, B y C ocurrieron
completas antes de que existiera un solo commit, así que los cinco commits temáticos son una
**reconstrucción por temas, no un registro de lo que pasó**. No hay forma de usar `git log`,
`git bisect` o `git blame` para responder cuándo se descubrió que `rubato` asignaba memoria en
el callback (ADR 0008), o en qué orden se probaron las carátulas: para git, todo eso sucedió
el mismo día.

Esa información no se perdió, pero vive en otra parte: la cronología real está en
`docs/BITACORA.md` y el porqué de cada decisión en `docs/decisiones/`. La asimetría es
deliberada y conocida — es el costo irrecuperable de haber empezado a versionar tarde, y la
única forma de no volver a pagarlo es que de aquí en adelante cada sesión de trabajo cierre
con sus propios commits.
