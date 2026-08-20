# El motor de audio (Fase B — Rust)

**Implementado.** Este documento se escribió en dos pasadas: el diseño original (Fase 0, antes
de tocar Rust) y una actualización tras construir `audio/` de verdad, donde apareció una
diferencia real respecto al plan — ver
`docs/decisiones/0008-hilo-dedicado-de-resampleo.md`. Lo que sigue describe la implementación
real, no el borrador inicial.

## El núcleo: tres ring buffers, no uno

`passthrough.rs` construye dos streams `cpal` (entrada y salida). Entre ellos NO hay un único
ring buffer con resampleo dentro del callback de salida (así se planeó originalmente) — hay tres
ring buffers `rtrb` (SPSC, lock-free) y un hilo de resampleo dedicado en medio:

```
callback ENTRADA (realtime)    hilo de RESAMPLEO (no realtime)   callback SALIDA (realtime)
  copia muestras del      A         pop, resample con      B        pop, aplica ganancia,
  par de canales     ────────►    ratio variable (rubato,  ───────►  escribe al hardware
  seleccionado,                   drift.rs), push a B                (o genera el tono de
  push a A, nunca                                                     prueba si está activo)
  bloquea                                                                    │
                                                                              │ push post-ganancia
                                                                              ▼
                                                                        C: tap de análisis
                                                                        (analysis.rs, no realtime)
```

Por qué el resampleo NO vive en el callback de salida: `rubato` asigna memoria por dentro en
cada llamada, lo que viola la regla de "cero asignaciones en el callback" de abajo. Ver el ADR
0008 para el razonamiento completo, incluida la parte más delicada: cuando cambia el dispositivo
de salida por defecto del sistema, hay que recuperarle la propiedad del extremo lector del ring
buffer A al hilo de resampleo viejo (uniéndose a él) antes de dárselo al nuevo, para que el
stream de ENTRADA nunca se corte — ver `Engine::on_output_device_changed` en `audio/mod.rs`.

## Reglas no negociables del código en tiempo real

Dentro de ambos callbacks: **cero asignaciones de memoria, cero locks, cero I/O**. Cualquier
excepción exige su propio ADR (ver `CLAUDE.md`). En la práctica:

- El resampleo (que sí asigna memoria por dentro, en `rubato`) **no vive en ningún callback** —
  vive en su propio hilo (`drift::spawn_resampler_thread`), ver ADR 0008 más arriba. Los
  callbacks de `cpal` solo copian muestras y multiplican por la ganancia.
- Si el ring buffer B está vacío en el callback de salida (underrun: el hilo de resampleo no
  entregó a tiempo), se escribe silencio y se incrementa un contador atómico (`underruns` en
  `OutputControls`) — nunca se bloquea esperando datos.
- Cualquier trabajo que no sea estrictamente mover y transformar muestras (análisis, logging,
  actualización de UI) vive en otro hilo, nunca en el callback.

## Análisis para el visualizador: `analysis.rs`

El ring buffer C (el tap post-ganancia del diagrama de arriba) alimenta un hilo **no realtime**
que calcula pico/RMS por canal, el buffer de osciloscopio submuestreado y la FFT (`rustfft`,
con ventana de Hann aplicada a mano — Web Audio la trae gratis por dentro de `AnalyserNode`, en
Rust no), y deja el resultado en un `Mutex<AudioFrame>`. El frontend lo consulta con
`invoke('get_frame')` dentro de su propio `requestAnimationFrame` — ver ADR 0006 para por qué se
eligió polling en vez de que Rust emita eventos.

## El tono de prueba: `testtone.rs`

Oscilador + ruido rosa que puede sustituir a la entrada real como fuente. Permite verificar
visualizador, volumen y ruta de salida sin hardware conectado — decisión de alcance en ADR 0004.

## El puente de PCM para MilkDrop (evaluación, no compromiso)

Si la carátula MilkDrop (`butterchurn`, ver `docs/decisiones/0007-dependencias-y-cadena-de-suministro.md`)
pasa de prototipo de Fase A a build nativo, necesita PCM crudo (ver `requiresPcm` en
`contrato-de-datos.md`). El diseño evaluado: Rust envía **mono submuestreado a ~22 kHz**
(~88 KB/s) a un `AudioWorklet` **silenciado y desconectado del destino real**, cuyo único
propósito es alimentar el analizador interno de Butterchurn. El audio que efectivamente se
escucha nunca sale del proceso Rust; lo que cruza el puente es una copia degradada solo apta para
visualizar.

Este puente **no está construido**; se decide en Fase B midiendo coste real de CPU, si el
visualizador mantiene 60 fps, y si el tráfico afecta al audio. Si no conviene, MilkDrop queda
como carátula exclusiva de la versión web (Fase A) sin afectar a las otras dos.

## Crates usados y por qué

- **`cpal` 0.18** — abstracción multiplataforma sobre CoreAudio (macOS) y WASAPI (Windows) para
  abrir streams de entrada/salida. Expone `DeviceId` estable — ver
  `docs/arquitectura/dispositivos.md`.
- **`rtrb`** — ring buffer SPSC lock-free. Se usan tres instancias (A, B, C — ver el diagrama de
  arriba), no una.
- **`rubato` 5.0** (+ `audioadapter-buffers`, que expone) — resampling de ratio variable, usado
  tanto para la corrección de deriva de reloj (ver `correccion-de-deriva.md`) como para el caso,
  muy probable, de que entrada y salida operen a tasas de muestreo distintas (p. ej. 44.1 kHz de
  un ADC de tocadiscos contra 48 kHz de la salida del sistema). API real usada:
  `Async::<f32>::new_poly(..., FixedAsync::Output)` — el tamaño de SALIDA es fijo (lo dictan los
  bloques del hilo de resampleo), el de entrada varía.
- **`rustfft`** — cálculo del espectro para el analizador de las carátulas.

## Soporte de formato de muestra

Los callbacks de entrada y salida negocian el formato del dispositivo (`cpal::SampleFormat`) y
solo saben convertir **F32 e I16** — los dos formatos más comunes en interfaces de audio de
consumo y profesionales. Un dispositivo que solo ofrezca otro formato (p. ej. U16) hace fallar
`start()` con un mensaje claro en vez de silenciarse o sonar mal. Ampliar esto es sencillo
(`passthrough.rs` ya usa un macro para generar el código por tipo) pero no se hizo sin evidencia
de que algún dispositivo real lo necesite.
