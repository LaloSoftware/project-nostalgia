# ADR 0003 — Orden de construcción: frontend con Web Audio primero, motor Rust después

**Estado:** aceptada — 2026-08-14

## Contexto

El ADR 0001 elige Tauri + Rust como stack final. Pero construir el motor de audio en Rust primero
mezclaría dos riesgos de naturaleza muy distinta en la misma fase: el riesgo de **diseño**
(¿la Consola Digital se ve y se siente bien?) y el riesgo de **DSP** (¿la corrección de deriva de
reloj entre dos dispositivos de audio distintos funciona sin clics?). El segundo es el punto más
difícil de todo el proyecto (ver `docs/arquitectura/correccion-de-deriva.md`) y no debería
bloquear la posibilidad de ver e iterar la interfaz.

## Alternativas consideradas

- **Motor Rust primero:** ataca la parte difícil antes, y confirma la latencia real en el hardware
  del usuario antes de invertir en diseño. Descartada como orden principal porque retrasa mucho
  ver algo utilizable, y el usuario necesita feedback visual temprano para validar el sistema de
  carátulas (el requisito estético es tan central como el funcional).
- **En paralelo, integrar al final:** más rápido en el total, pero concentra los problemas de
  integración al final, justo donde son más caros de depurar. Descartada.
- **Frontend primero — elegida.**

## Por qué funciona: el contrato de datos

El elemento que hace posible esta separación es que las carátulas consumen un contrato de datos
estable (`AudioFrame`, `EngineState` — ver `docs/arquitectura/contrato-de-datos.md`) al que le da
igual si los números vienen de un `AnalyserNode` de Web Audio o de un comando Tauri que expone el
mismo `Mutex<AudioFrame>` calculado en Rust. El código de las carátulas no cambia entre fases.

## Plan de fases

```
Fase A ─ Vite + TS + Web Audio (navegador)
         diseño de skins con audio real del tocadiscos
                   │  contrato de datos estable
                   ▼
Fase B ─ Tauri: motor Rust (cpal/rubato/rtrb)
         mismo frontend, backend nuevo
                   ▼
Fase C ─ bandeja: ventana destruida, ~20 MB
```

## Consecuencia aceptada

Hay trabajo que se hace dos veces en espíritu: `engine-web.ts` en la Fase A y `engine-tauri.ts` en
la Fase B implementan la misma interfaz `AudioEngine` con tecnologías distintas. Se acepta ese
costo porque permite que el usuario vea e itere el resultado estético (que es un requisito
explícito del proyecto, no un extra) desde el primer día, sin esperar a que el DSP nativo esté
resuelto.
