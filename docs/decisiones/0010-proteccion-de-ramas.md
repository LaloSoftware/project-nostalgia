# ADR 0010 — Protección de ramas con rulesets y flujo de pull requests

**Estado:** aceptada — 2026-08-19, horas después de publicar el repositorio

## Contexto

El ADR 0009 dejó nombrado un riesgo abierto: *"`develop` no está protegida. Un `push --force`
accidental sobre ella sí puede perder trabajo, ahora que el remoto ya no está vacío."* Mientras
el repositorio estuvo vacío ese riesgo era teórico; con las dos ramas publicadas dejó de serlo.

Al mismo tiempo cambió una premisa del ADR 0009. Ese ADR razonaba explícitamente sobre "un
proyecto de un solo desarrollador" —fue el motivo para descartar git-flow— y sobre esa base el
modelo era: trabajo directo sobre `develop`, merge a `main` al publicar. **Hay colaboradores
invitados al repositorio**, pendientes de aceptar. En cuanto acepten, "empujar directo a
`develop`" deja de significar "mi propio trabajo" y pasa a significar "el trabajo de todos, sin
que nadie lo haya visto".

Este ADR cierra el riesgo abierto y ajusta el flujo a esa premisa nueva.

## Decisión

Un ruleset de repositorio (`devPR`, id 21066955, `enforcement: active`) que protege las dos
ramas de larga vida con tres reglas:

| Regla | Efecto |
|---|---|
| `pull_request` | Sin push directo: todo cambio entra por PR, con **1 aprobación** requerida |
| `non_fast_forward` | Sin `push --force`: el historial publicado no se puede reescribir |
| `deletion` | Las ramas protegidas no se pueden borrar |

Alcance: `~DEFAULT_BRANCH` (es decir `main`) y `refs/heads/develop`. `bypass_actors` vacío.

Parámetros del `pull_request` que se dejaron en su valor por defecto y por qué:
`dismiss_stale_reviews_on_push = false` (una aprobación no se invalida al empujar más commits —
con revisores voluntarios, invalidar aprobaciones genera fricción desproporcionada),
`require_code_owner_review = false` (no hay `CODEOWNERS` y no tendría a quién apuntar),
`required_review_thread_resolution = false`. Los tres métodos de merge quedan permitidos.

### Por qué rulesets y no la protección clásica de ramas

Los rulesets son el mecanismo vigente y se pueden apilar (varios rulesets sobre la misma rama,
evaluados en conjunto), a diferencia de la protección clásica, que es una única regla por
patrón. Pero la diferencia decisiva aquí es otra: **en la protección clásica los administradores
quedaban exentos salvo que se activara explícitamente "include administrators"; en los rulesets
ocurre al revés** — nadie está exento salvo que se le liste en `bypass_actors`. Con
`bypass_actors` vacío, la regla aplica también al dueño del repositorio. Eso es exactamente lo
que se quiere de una protección que existe para atrapar accidentes propios.

## Alternativas consideradas y por qué se descartaron

### 0 aprobaciones requeridas

Es la configuración estándar para un proyecto de un solo desarrollador: el PR sigue siendo
obligatorio —obliga a mirar el diff completo y deja registro— pero se puede fusionar sin
esperar a nadie. Se descartó porque la premisa de "un solo desarrollador" es justamente la que
cambió: con colaboradores en camino, exigir una revisión ajena real es el punto de tener el
ruleset, no un obstáculo.

**Consecuencia asumida:** ver el bloqueo temporal descrito más abajo.

### Añadir al administrador como `bypass_actors`

Permitiría fusionar sin esperar aprobación manteniendo la regla para el resto. Se descartó por
un detalle importante de cómo funcionan los rulesets: **el bypass es por actor, no por regla**.
Listarse como actor de bypass no exime solo del `pull_request` — exime de las tres reglas del
ruleset, incluida `non_fast_forward`. Es decir, se perdería precisamente la protección contra
el `push --force` que motivó este ADR. Se cambiaría un riesgo real por una comodidad.

Queda como **salida de emergencia consciente**: si hay que fusionar algo antes de que un
colaborador acepte la invitación, se añade el bypass, se fusiona y se retira en el acto.

### Alcance `~ALL` (toda rama del repositorio)

Fue la configuración inicial del ruleset, y se corrigió al detectar sus efectos. Con `~ALL`,
las tres reglas aplican también a las ramas de trabajo —se verificó consultando las reglas
efectivas de una rama hipotética `feature/cualquiera`, y le aplicaban las tres— con dos
consecuencias que nadie quería:

- **`deletion` en toda rama:** ninguna rama se puede borrar nunca, así que el botón "Delete
  branch" al fusionar un PR falla y las ramas de trabajo se acumulan sin límite.
- **`pull_request` en toda rama:** una rama de trabajo propia rechaza los pushes directos. Se
  podría crear (no hay regla `creation` que lo impida) pero no recibir un segundo commit: cada
  corrección exigiría rehacerla con otro nombre.

El alcance se limitó a `main` y `develop`. Las ramas de trabajo se crean, reciben pushes y se
borran con normalidad; lo que está protegido es el destino, no el camino.

## Flujo resultante

```
feature/*  ●──●──●   sin restricciones: push libre, borrado libre
                  ╲
develop            ●   ← solo por PR, 1 aprobación, sin force-push
                    ╲
main                 ●   ← solo por PR, 1 aprobación, sin force-push
```

Cada sesión de trabajo abre su rama, empuja ahí, y entra a `develop` por PR revisado.

## Riesgos conocidos y consecuencias asumidas

- **Bloqueo temporal hasta que un colaborador acepte la invitación.** GitHub no permite aprobar
  el propio pull request, y con `bypass_actors` vacío el administrador tampoco está exento. En
  el intervalo entre activar el ruleset y la primera aceptación, **no se puede fusionar nada**:
  los PRs se abren y quedan esperando. Es un estado transitorio conocido, no una
  configuración incorrecta, y tiene la salida de emergencia descrita arriba.
- **El commit raíz vacío de `main` es ahora irreversible de hecho.** El ADR 0009 lo listó como
  "permanente" porque rehacerlo exigiría `rebase --root` y un push forzado sobre las dos ramas;
  `non_fast_forward` convierte esa dificultad en una imposibilidad mientras el ruleset esté
  activo. Lo mismo aplica a la observación del ADR 0009 sobre el email del autor en el
  historial: ya no se puede reescribir sin desactivar la regla antes.
- **`dismiss_stale_reviews_on_push = false`** significa que un PR aprobado puede recibir commits
  nuevos y fusionarse con la aprobación anterior, que ya no corresponde a lo revisado. Es un
  hueco real; se acepta a cambio de no bloquear a revisores voluntarios, y se revisará si el
  número de colaboradores activos crece.
- **Las ramas de trabajo no están protegidas de nada.** Es deliberado, pero implica que un
  `push --force` sobre una rama propia sigue pudiendo perder trabajo no fusionado.

## Qué se sacrificó

**La velocidad de una sola persona trabajando sola.** Esta primera sesión de integración
—siete commits, incluida toda la publicación inicial— se hizo empujando directo a `develop`, y
eso ya no es posible. De aquí en adelante cada cambio, por pequeño que sea, cuesta una rama, un
PR, la espera de una revisión ajena y un merge. Para una corrección de una línea en un archivo
de documentación, esa ceremonia es objetivamente desproporcionada.

Se acepta porque el costo se paga por cambio y el beneficio se cobra una sola vez, el día que
evita el accidente: un `push --force` sobre `develop`, o un cambio en la ruta de audio de
tiempo real que nadie más miró. En un proyecto donde `passthrough.rs` y `drift.rs` no admiten
ni una asignación de memoria (CLAUDE.md), que un segundo par de ojos sea obligatorio antes de
tocar `develop` vale más que la agilidad que se pierde.

**El ADR 0009 no queda sustituido**, solo acotado: su modelo de dos ramas sigue vigente, pero
su supuesto de "un solo desarrollador" ya no describe el proyecto, y su riesgo abierto sobre
`develop` queda cerrado aquí.
