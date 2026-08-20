# CLAUDE.md — Directivas de desarrollo para Nostalgia

Este archivo son instrucciones para Claude (o cualquier agente que trabaje en este repositorio).
No es documentación de producto — eso vive en `docs/`.

## Separación de la raíz

```
Nostalgia/
├── CLAUDE.md      ← este archivo: directivas de desarrollo
├── docs/          ← documentación de proceso, decisiones y arquitectura
└── app/           ← la aplicación (frontend + src-tauri)
```

Nunca mezclar estos tres dominios. La documentación **jamás** vive dentro de `app/`; el código
de producto **jamás** vive dentro de `docs/`. Un lector debe poder entender por qué el proyecto
es como es leyendo solo `docs/`, sin abrir una sola línea de `app/`.

## Directiva de documentación (obligatoria, no opcional)

Toda decisión técnica no trivial se documenta **con el mismo nivel de detalle que se discutió en
la conversación de planeación original**. No basta con registrar qué se decidió. Cada entrada debe
incluir:

1. **Las alternativas consideradas** y por qué se descartaron.
2. **Los números concretos** que sustentan la decisión (latencias, memoria, ppm de deriva de
   reloj, tamaños de paquete, lo que aplique).
3. **Los riesgos conocidos** y las consecuencias que se asumen al elegir esta opción sobre otra.
4. **Qué se sacrificó.** Ninguna decisión de este proyecto es gratuita; nombrar el costo es parte
   de documentarla.

Una entrada que solo dice "usamos Tauri" o "se agregó `culori` para los colores" **incumple esta
directiva** y debe reescribirse. El estándar de referencia son los ADRs 0001–0007 en
`docs/decisiones/`, escritos a partir de la conversación de planeación de este proyecto —úsalos
como plantilla de profundidad esperada, no solo de formato.

Cada decisión con impacto arquitectónico nuevo se documenta como **un ADR nuevo**, numerado
secuencialmente, con estado (`propuesta` / `aceptada` / `sustituida por NNNN`).

## Gestor de paquetes: pnpm, siempre

Nunca `npm install` ni `yarn` en este repositorio. Mezclar gestores produce árboles de
dependencias divergentes y anula las protecciones configuradas en `.npmrc` (ver
`docs/decisiones/0007-dependencias-y-cadena-de-suministro.md`).

## Política de dependencias

Cada dependencia nueva de terceros se justifica en un ADR con: licencia, número de mantenedores,
dependencias transitivas, y qué pasa si el paquete desaparece del registro. Se prefieren paquetes
sin dependencias en runtime. **Ninguna dependencia de terceros entra en la ruta de audio en tiempo
real** (`app/src-tauri/src/audio/passthrough.rs` y `drift.rs`) — solo en la capa de presentación.

## Idioma

Español para documentación y comentarios de código. Inglés para identificadores de código
(nombres de variables, funciones, tipos).

## Bitácora

Actualizar `docs/BITACORA.md` al cerrar cada sesión de trabajo relevante: qué se hizo, qué se
decidió, qué quedó pendiente y por qué.

## Reglas del código de tiempo real

Dentro de los callbacks de audio (`passthrough.rs`, cualquier callback de `cpal`): **cero
asignaciones de memoria, cero locks, cero I/O**. Cualquier excepción a esta regla exige su propio
ADR explicando por qué es segura en ese caso concreto.

## El contrato de `types.ts` es estable

`app/src/core/types.ts` (`AudioFrame`, `EngineState`, `Skin`, `SkinManifest`, `SkinHostApi`) es el
contrato entre el motor de audio y las carátulas. Romperlo o extenderlo de forma incompatible
requiere un ADR, porque de él dependen todas las carátulas presentes y futuras — incluidas las que
el usuario aún no ha pedido.
