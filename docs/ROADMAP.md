# Roadmap — qué queda fuera de la v1 y por qué

Cada punto aquí fue considerado durante la planeación y deliberadamente excluido del alcance de
v1 (ver ADR 0004). Se documenta la justificación de cada uno para que decidir sumarlo después sea
una decisión informada, no una sorpresa.

## Reconexión automática del dispositivo de entrada

**Qué:** si se desconecta el tocadiscos (se desenchufa el USB, se apaga), detectar cuando vuelve
a estar disponible y reanudar automáticamente, sin que el usuario tenga que volver a seleccionarlo
a mano.

**Por qué no está construido:** el diseño original de la Fase 0 (`docs/arquitectura/dispositivos.md`)
asumía esto como parte del comportamiento base. Al implementar la Fase B se priorizó la mitad
difícil y verificable (la corrección de deriva, la reconstrucción de la salida sin cortar la
entrada) y se dejó esto documentado como pendiente en vez de construirlo con menos cuidado del
necesario. Hoy el callback de error de `cpal` detecta la desconexión y la registra
(`log::error!`), pero el motor no reintenta solo — ver `docs/arquitectura/dispositivos.md`.

**Costo esperado si se construye:** extender `devices::spawn_output_watcher` (o un hilo hermano)
para vigilar también la lista de dispositivos de ENTRADA, detectar cuándo reaparece uno que
coincide con el `device_id` guardado, y llamar a `Engine::start()` de nuevo con el mismo
`device_id`/`channel_pair`. La pieza no trivial es evitar reintentos en bucle apretado si el
dispositivo aparece y desaparece rápido (rebote de USB) — necesitaría un pequeño *debounce*.

## Salida de audio independiente del sistema

**Qué:** poder elegir un dispositivo de salida distinto del que el sistema operativo tiene como
predeterminado, en vez de seguirlo siempre — mencionado explícitamente por el usuario como algo a
documentar para una futura iteración.

**Por qué no en v1:** el requisito original pedía explícitamente que la salida "se tome del
dispositivo de salida configurado del sistema". Cambiarlo habría sido ampliar el alcance sin
pedirlo.

**Por qué es casi trivial añadirlo después:** la arquitectura de Fase B ya construye el stream de
salida como algo reconstruible dinámicamente (necesario para seguir los cambios de dispositivo por
defecto — ver `docs/arquitectura/dispositivos.md`). Añadir esta función es, en esencia, dejar de
seguir automáticamente el `default_output_device()` y en su lugar fijar el dispositivo que el
usuario eligió explícitamente. La pieza más grande del trabajo (reconstrucción de stream en
caliente sin cortar audio) ya existe por otra razón.

## Grabación a archivo (WAV/FLAC)

**Qué:** capturar la entrada a un archivo en disco, con detección de silencio para sugerir cortes
entre pistas — pensado para digitalizar vinilos antes de grabarlos en el lector de CD/DVD/BR que
el usuario también tiene.

**Por qué no en v1:** no fue pedido como requisito explícito; se mencionó el grabador como
contexto de equipo, no como intención confirmada de construir esta función ahora (ver ADR 0004).

**Costo esperado si se construye:** un buffer de escritura a disco alimentado desde el mismo tap
de audio que usa `analysis.rs`, más lógica de detección de silencio. No toca el núcleo realtime de
`passthrough.rs` directamente, pero sí añade I/O de disco que debe vivir estrictamente fuera de
los callbacks de audio.

## Ecualizador de 3 bandas y balance L/R

**Qué:** EQ de graves/medios/agudos y balance izquierda/derecha en la cadena de audio.

**Por qué no en v1:** no fue pedido; encaja bien con la estética de consola pero es alcance
adicional (ADR 0004).

**Costo esperado si se construye:** relativamente barato en Rust (filtros biquad estándar),
insertado en la cadena entre el resampler y la salida en `passthrough.rs`. Sí entra en el núcleo
realtime, así que su implementación exige seguir las mismas reglas de cero asignaciones/cero locks
(ver `docs/arquitectura/motor-de-audio.md`).

## ASIO en Windows

**Qué:** usar drivers ASIO para bajar el techo de latencia en Windows a niveles comparables a
macOS (ver ADR 0002, donde WASAPI en modo compartido deja un piso de ~20–30 ms).

**Por qué no en v1:** el tocadiscos USB no trae driver ASIO; la tarjeta de audio del usuario en el
PC probablemente sí, pero confirmarlo y construir sobre ASIO complica el build de Windows (SDK
propio, típicamente requiere ASIO4ALL como puente para dispositivos sin ASIO nativo). Se activa
con la feature `asio` de `cpal`.

**Cuándo reconsiderar:** si, tras usar la v1 en Windows, la latencia resulta molesta en la
práctica (ver la nota sobre *direct monitor* en `docs/hardware/montaje-del-usuario.md` como
alternativa de hardware que podría hacer esto innecesario).

## Soporte Linux

**Qué:** empaquetar y soportar distribuciones Linux, mencionado por el usuario como algo a evaluar
más adelante.

**Fricción conocida, documentada de antemano:**
- Tauri en Linux usa **WebKitGTK**, el más flojo de los tres webviews soportados (frente a
  WebKit en macOS y WebView2/Chromium en Windows). Es esperable que el tema de consola necesite
  ajustes de render y consuma más CPU que en las otras dos plataformas.
- `cpal` en Linux habla ALSA; PipeWire y PulseAudio se exponen a través de la capa de
  compatibilidad ALSA, lo cual normalmente funciona pero añade latencia adicional y algunos casos
  extremos conocidos en la comunidad de `cpal`.
- Ninguno de los dos puntos es bloqueante, pero Linux es, de las tres plataformas, la que tiene
  más fricción esperada — no se recomienda tratarlo como "gratis" solo porque Tauri es
  multiplataforma en teoría.

## Modo mini / siempre encima

**Qué:** además de la bandeja del sistema (ver ADR 0005), una vista compacta tipo widget flotante
sobre otras ventanas, con visualizador reducido y control de volumen — muy en el espíritu visual
de los reproductores antiguos que motivan este proyecto.

**Por qué no en v1:** trabajo de diseño adicional que cada carátula tendría que resolver por
separado; no fue parte del alcance confirmado.

## MilkDrop en el build nativo (Fase B)

**Qué:** llevar la carátula MilkDrop (prototipada en Fase A sobre `butterchurn`) al motor nativo
de Rust, lo que requiere un puente de PCM crudo entre el proceso Rust y un `AudioWorklet` — ver
`docs/arquitectura/motor-de-audio.md`, sección "El puente de PCM para MilkDrop".

**Por qué está aquí y no comprometido:** su viabilidad depende de mediciones reales (coste de CPU
del puente, si se sostienen 60 fps, impacto en el audio) que solo se pueden tomar una vez que el
motor de Fase B existe. Si no conviene, la carátula queda como exclusiva de la versión web sin
afectar a las otras dos — el contrato `requiresPcm` (ver `docs/arquitectura/contrato-de-datos.md`)
existe precisamente para que esta decisión sea reversible sin costo para el resto del sistema.

## Tercera+ carátula

Con dos carátulas comprometidas más el prototipo de MilkDrop, el sistema de skins ya queda
ejercitado con variedad real (ver ADR 0004). Cualquier carátula adicional después de la v1 sigue
`docs/guias/crear-una-caratula.md` una vez que ese documento exista (se escribe al terminar las
tres carátulas de la Fase A, no antes — ver ADR 0003).
