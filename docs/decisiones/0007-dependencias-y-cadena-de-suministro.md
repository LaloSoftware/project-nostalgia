# ADR 0007 — Dependencias del frontend y endurecimiento de la cadena de suministro con pnpm

**Estado:** aceptada — 2026-08-14

## Contexto

El usuario pidió explícitamente usar librerías que den buena estética a la aplicación (mencionando
`morphicons` como ejemplo, no como requisito cerrado) y trabajar con **pnpm** "para evitar
sorpresas de seguridad". Esto exige dos cosas: elegir dependencias concretas con criterio
verificable, y configurar pnpm de forma que la frase "evitar sorpresas" sea real y no solo una
elección de CLI.

## Gestor de paquetes: pnpm

Se usa pnpm 10.25.0 (ya instalado en el entorno de desarrollo) en vez de npm o yarn. Razones:

- **Scripts de ciclo de vida bloqueados por defecto.** Desde pnpm 10, los `postinstall` de
  dependencias no se ejecutan salvo que se aprueben explícitamente en `onlyBuiltDependencies` de
  `package.json`. Este es el vector de ataque más común en incidentes de cadena de suministro de
  npm (paquete comprometido ejecuta código arbitrario al instalar). Cada aprobación futura debe
  justificarse en este ADR o en uno nuevo.
- **`minimumReleaseAge`** configurable en `.npmrc`: pnpm puede rehusarse a instalar versiones
  publicadas hace menos de N minutos. Es la defensa directa contra una cuenta de mantenedor
  comprometida — ese tipo de ataque suele detectarse y despublicarse en horas, así que exigir que
  una versión tenga al menos 24 h de antigüedad filtra la enorme mayoría de estos incidentes sin
  bloquear el uso normal del paquete.
- **`packageManager` fijado** en `package.json` + corepack, para que la versión exacta del gestor
  sea reproducible entre máquinas y no dependa de lo que cada una tenga instalado.

## Configuración concreta

```
# .npmrc
minimum-release-age=1440   # 24 h, en minutos
```

```json
// package.json (fragmento)
"packageManager": "pnpm@10.25.0"
```

Versiones exactas (sin `^` ni `~`) para dependencias directas, `pnpm-lock.yaml` versionado en git,
e instalaciones en CI/build con `--frozen-lockfile` para que nunca se resuelva un árbol distinto
al commiteado.

## Por qué `minimumReleaseAge` es especialmente pertinente en este proyecto

`morphicons`, la librería de iconos morfeados propuesta por el usuario, tiene **un solo
mantenedor** y publica con mucha frecuencia (v1.7.0 publicada el día anterior a esta decisión).
Ese perfil —mantenedor único, cadencia de publicación alta— es exactamente el que más se
beneficia de una ventana de cuarentena antes de instalar: si esa cuenta se ve comprometida, la
ventana de 24 h da tiempo a que la comunidad o el registro lo detecten antes de que este proyecto
instale la versión afectada.

## Dependencias del frontend evaluadas y su justificación

Todas verificadas contra el registro npm (versión real, licencia, fecha de publicación) antes de
incluirlas — ninguna se agregó por nombre de memoria.

| Paquete | Para qué | Licencia | Por qué se acepta |
|---|---|---|---|
| `dseg` | Tipografía de 7/14 segmentos para displays LCD (Consola Digital) | OFL-1.1 | Es una fuente: su antigüedad de publicación (2022) es irrelevante — las tipografías no "caducan" como el código con dependencias |
| `@fontsource/vt323`, `@fontsource/share-tech-mono` | Tipografías autoalojadas de terminal/CRT | OFL-1.1 | Autoalojar es **obligatorio**: la CSP de Tauri bloquea hosts externos, así que Google Fonts servido remotamente no es viable |
| `culori` | Construir rampas de color del espectro/medidores en OKLCH | MIT | Solo `devDependency` — se usa en build para generar una tabla de consulta estática; cero huella en runtime |
| `morphicons` | Morphing de iconos de trazo con física de resortes | MIT | Cero dependencias en runtime, 156 KB. Se acepta el riesgo de mantenedor único precisamente porque `minimumReleaseAge` lo mitiga |
| `lucide` | Set de iconos de trazo (insumo de `morphicons`) | MIT | Muy establecido, importación por icono con tree-shaking |
| `motion` (`motion/mini`) | Física de resortes para el panel de ajustes | MIT | Muy activo; se usa el build reducido (~2,5 KB) en vez del paquete completo |
| `butterchurn`, `butterchurn-presets` | Carátula MilkDrop (ver ADR sobre carátulas y `requiresPcm`) | MIT | Port mantenido del visualizador de Winamp; los presets son datos estáticos, no código — no "envejecen" aunque no se toquen desde 2022 |

## Aprobaciones de scripts de instalación (`onlyBuiltDependencies`)

Registro de cada script de ciclo de vida que pnpm bloqueó y la decisión tomada — ver la regla
general más arriba.

| Paquete | Decisión | Motivo |
|---|---|---|
| `esbuild` (transitivo de `vite`/`tsx`) | **Aprobado** en `package.json` → `pnpm.onlyBuiltDependencies` | El script solo descarga el binario nativo de esbuild para la plataforma actual; sin él, `vite`/`tsx` no funcionan en absoluto. Necesario y de bajo riesgo (el propio esbuild es una dependencia de primer nivel del ecosistema, ampliamente auditada). |
| `core-js` (transitivo de `butterchurn-presets`, vía Babel) | **No aprobado, queda bloqueado** | Su `postinstall` es únicamente un mensaje pidiendo patrocinio (práctica conocida y documentada del mantenedor de `core-js`), no construye nada que la librería necesite en runtime. Es exactamente el tipo de script que la política de `onlyBuiltDependencies` está pensada para filtrar: no aprobar por defecto y solo aprobar caso por caso cuando hay una razón funcional. |

## Qué se descartó y por qué

- **Tailwind / cualquier framework CSS de utilidades:** cada carátula es una identidad visual
  autocontenida con su propio CSS; clases de utilidad compartidas filtrarían las suposiciones
  visuales de una carátula dentro de otra, exactamente lo que la arquitectura de skins busca
  impedir.
- **`three` + `postprocessing`** para los efectos CRT de la Consola Digital: desproporcionado para
  un efecto 2D de un solo pase. Se escribe un shader de fragmentos WebGL2 a mano (~100 líneas) en
  su lugar.
- **`nexusui`:** controles de audio skeuomórficos listos, pero visualmente muy opinionados y sin
  mantenimiento desde 2022 (a diferencia de `dseg`, aquí sí importa porque es código de
  interacción, no una fuente estática). Pelearía contra el sistema de carátulas en vez de servirlo.
- **`ogl`:** evaluado como plan B si el shader WebGL2 escrito a mano se complica más de lo
  esperado. Licencia Unlicense, muy pequeño. No descartado por riesgo, sino por no ser necesario
  todavía.

## Auditoría continua

`pnpm audit` como parte de la rutina de desarrollo, y `cargo audit` / `cargo deny` para el lado
Rust — que la atención puesta en el ecosistema npm suele dejar sin cubrir.
