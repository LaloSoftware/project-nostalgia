# ADR 0008 — Resampleo en un hilo dedicado, no dentro del callback de salida

**Estado:** aceptada — 2026-08-14, durante la implementación de la Fase B

## Contexto

El diagrama original en `docs/arquitectura/motor-de-audio.md` (escrito en la Fase 0, antes de
tocar Rust) mostraba el resampleo ocurriendo dentro del callback de salida: `lee → resample →
ganancia → salida`. Al implementar `passthrough.rs` y `drift.rs` de verdad, esa forma resultó
incorrecta de construir tal como estaba planeada.

## El problema descubierto durante la implementación

`rubato` (el resampler — ver ADR 0001 y `docs/arquitectura/correccion-de-deriva.md`) asigna
memoria internamente en cada llamada a `process_into_buffer` (buffers de trabajo para la
interpolación). Eso viola directamente la regla de "cero asignaciones en el callback de audio"
(CLAUDE.md) si se llama desde dentro del callback de salida de `cpal`, que corre en el hilo de
tiempo real del sistema operativo.

## Decisión

El resampleo se mueve a su **propio hilo dedicado** (`drift::spawn_resampler_thread`), separado
de ambos callbacks de hardware. La arquitectura real tiene tres ring buffers, no uno:

```
callback de ENTRADA (realtime)     hilo de RESAMPLEO (no realtime)    callback de SALIDA (realtime)
   copia muestras,           A            pop, resample con           B         pop, aplica
   push a A, nunca      ────────►    ratio variable (rubato),   ────────►   ganancia, escribe
   bloquea                            push a B                              al hardware
                                                                                  │
                                                                                  │ push (post-ganancia)
                                                                                  ▼
                                                                            C: tap de análisis
                                                                            (hilo no realtime,
                                                                             ver analysis.rs)
```

- **A** (entrada cruda → resampleo): ~200 ms de colchón.
- **B** (ya resampleada → callback de salida): ~200 ms de colchón. El callback de salida ahora
  es trivial — copiar muestras y multiplicar por la ganancia, nada más.
- **C** (tap post-ganancia → análisis): ~100 ms, alimenta `analysis.rs`.

Esto es un refinamiento real sobre el diagrama de la Fase 0, no un simple detalle de
implementación: cambia cuántos ring buffers hay y dónde vive la latencia añadida.

## Costo aceptado

- **Latencia:** el colchón combinado de A+B (ver `estimate_latency_ms` en `audio/mod.rs`) es
  mayor que si el resampleo ocurriera in-line en el callback de salida con un solo buffer. Se
  acepta porque la alternativa (resamplear dentro del callback) no es segura de construir con
  `rubato` tal como existe, y porque el objetivo de latencia de este proyecto ya asumía un
  colchón de cientos de milisegundos, no unidades de milisegundos — ver
  `docs/decisiones/0002-latencia-y-filtro-de-peine.md`.
- **Complejidad de reconstrucción:** cuando cambia el dispositivo de salida por defecto del
  sistema (ver `docs/arquitectura/dispositivos.md`), hay que recuperar la propiedad de
  `Consumer<f32>` del ring buffer A desde el hilo de resampleo viejo antes de poder dárselo al
  nuevo — se resuelve haciendo que `spawn_resampler_thread` devuelva el `Consumer` al terminar
  (`JoinHandle<Consumer<f32>>` en vez de `JoinHandle<()>`) y uniéndose a él (`.join()`) antes de
  reconstruir. Ver el comentario extenso en `Engine::on_output_device_changed` y
  `rebuild_output_session` en `audio/mod.rs`.

## Por qué no se consideró viable la alternativa in-line

Se evaluó brevemente pre-asignar todos los buffers de `rubato` una sola vez y reutilizarlos
dentro del callback (evitando la asignación por llamada). `rubato` no expone una API pública para
inyectar sus buffers internos de trabajo — son un detalle de implementación del crate. Forzarlo
habría significado o bien parchear/vendorizar `rubato`, o reimplementar el resampler a mano,
ninguna de las dos proporcional al problema. El hilo dedicado es la solución idiomática que el
propio ecosistema de audio en Rust usa para este caso.
