# El contrato de datos: `app/src/core/types.ts`

Este es el archivo más importante del proyecto en términos de estabilidad: romperlo o extenderlo
de forma incompatible requiere un ADR (ver `CLAUDE.md`), porque de él dependen todas las carátulas
presentes y futuras.

## Los tipos

```ts
AudioFrame   { peakL, peakR, rmsL, rmsR, scope, scopeR, spectrum, clip }
EngineState  { running, device, channelPair, gainDb, muted,
               sampleRateIn, sampleRateOut, latencyMs, source }
Skin         { manifest, mount(root, host), render(frame, state), unmount() }
SkinManifest { id, name, author, requiresPcm?: boolean }
SkinHostApi  { setGainDb, toggleMute, selectDevice, setSource, openSettings }
```

### `AudioFrame` — lo que se ve

Datos de análisis ya procesados, calculados por el motor a partir del audio real: picos y RMS por
canal (para medidores tipo VU), un buffer de osciloscopio submuestreado por canal, y las
magnitudes de espectro (para el analizador tipo ecualizador gráfico). `clip` indica si la señal
tocó el techo. Nunca es audio crudo — eso es intencional, ver la sección `requiresPcm` más abajo.

### `EngineState` — lo que está pasando

El estado operativo: si el motor está corriendo, qué dispositivo de entrada y qué par de canales
están seleccionados, la ganancia en dB, si está silenciado, las tasas de muestreo de entrada y
salida, la latencia real medida, y la fuente activa (entrada real vs tono de prueba).

### `Skin` — el contrato que implementa cada carátula

`mount(root, host)` recibe el elemento DOM donde dibujar y el `SkinHostApi` para emitir
intenciones; `render(frame, state)` se llama en cada frame del bucle de dibujo; `unmount()` libera
recursos (contextos WebGL, listeners) al cambiar de carátula. Una carátula nunca lee el estado por
su cuenta ni muta el `AudioFrame` — solo recibe y dibuja.

### `SkinHostApi` — lo único que una carátula puede pedir

Un conjunto deliberadamente pequeño de intenciones: cambiar la ganancia, silenciar, seleccionar
dispositivo, cambiar de fuente (entrada real / tono de prueba), abrir el panel de ajustes. El host
(no la carátula) decide qué hacer con cada intención y es la única fuente de verdad del
`EngineState`.

## `requiresPcm`: el punto de extensión para carátulas como MilkDrop

El `AudioFrame` compacto cubre a cualquier carátula normal (medidores, osciloscopio, espectro).
Pero una carátula que envuelve un motor de visualización de terceros con su propio analizador
interno — el caso de la carátula MilkDrop sobre `butterchurn` — necesita PCM crudo, no datos ya
reducidos.

Una carátula declara `requiresPcm: true` en su `SkinManifest` para pedir, además del `AudioFrame`
normal, un flujo de muestras de audio crudo. El host **solo paga ese costo mientras esa carátula
está activa**; el resto del tiempo el flujo de PCM ni siquiera existe. Sin este campo, la única
alternativa sería enviar PCM crudo siempre (desperdiciando ancho de banda IPC el 99% del tiempo
en carátulas que no lo necesitan) o cerrarle la puerta a este tipo de carátula para siempre.

En la Fase A, `requiresPcm` se ejercita de verdad: Butterchurn se conecta a un nodo de Web Audio
directamente, sin costo adicional. En la Fase B implica un puente real (audio Rust → `AudioWorklet`
silencioso) cuyo costo se mide antes de decidir si entra al build nativo — ver
`docs/decisiones/` (evaluación de MilkDrop) y `motor-de-audio.md`.
