# Visión general de la arquitectura

## El principio rector: un contrato de datos estable

Todo el diseño de Nostalgia gira alrededor de un único contrato entre el **motor de audio** y las
**carátulas**: `app/src/core/types.ts`. A una carátula le da igual si los números que recibe vienen
de un `AnalyserNode` de Web Audio (Fase A, ver ADR 0003) o de un comando Tauri que expone un
`Mutex<AudioFrame>` calculado en Rust (Fase B). Ese límite es lo que permite:

- Iterar el diseño visual con audio real desde el primer día, sin esperar al motor nativo.
- Sustituir el motor completo (Fase B) sin tocar una sola línea de las carátulas.
- Añadir una tercera, cuarta o quinta carátula sin negociar nada con el motor — ver
  `docs/guias/crear-una-caratula.md`.

Ver el detalle completo del contrato en `contrato-de-datos.md`.

## Los tres bloques del sistema

```
┌─────────────────────────┐     AudioFrame / EngineState     ┌──────────────────────┐
│   Motor de audio         │ ────────────────────────────────▶│   Carátula activa     │
│   (engine-web.ts en A /  │                                   │   (Skin)              │
│   Rust + engine-tauri.ts │ ◀──────────────────────────────── │   dibuja, no decide   │
│   en B)                  │      SkinHostApi (intenciones)    │                        │
└─────────────────────────┘                                   └──────────────────────┘
           │
           ▼
   dispositivo de entrada          dispositivo de salida
   (tocadiscos / tarjeta)          (por defecto del SO)
```

El motor es dueño del estado (`EngineState`) y de la verdad de lo que suena. Las carátulas solo
dibujan lo que reciben y emiten intenciones (`SkinHostApi`) — nunca leen ni escriben el estado
directamente. Este límite es el que impide que una carátula "opinione" sobre otra o rompa el
motor al cambiarse en caliente.

## Por dónde entrar a leer esta documentación

1. `docs/decisiones/0001-stack-tauri-vs-electron.md` — por qué Tauri, con los números que lo
   sustentan.
2. `contrato-de-datos.md` — la superficie exacta que separa motor de carátulas.
3. `motor-de-audio.md` y `correccion-de-deriva.md` — cómo funciona el núcleo en tiempo real
   (Fase B), incluida la parte más delicada del proyecto.
4. `dispositivos.md` — cómo se maneja la enumeración, el hot-plug y el seguimiento del
   dispositivo de salida por defecto del sistema.
