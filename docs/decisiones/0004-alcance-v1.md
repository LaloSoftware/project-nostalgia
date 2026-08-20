# ADR 0004 — Alcance de la v1

**Estado:** aceptada — 2026-08-14

## Contexto

El requerimiento original pedía explícitamente: selector de entrada, volumen master, y salida
tomada del dispositivo por defecto del sistema, con estética de reproductor antiguo. Durante la
planeación surgieron candidatos naturales a sumar (grabación a archivo, ecualizador) por la
mención del grabador de CD/DVD/BR del usuario, pero se decidió no ampliar el alcance sin
confirmarlo explícitamente con el usuario.

## Qué entra en la v1

- Selector de entrada de audio, incluyendo selector de **par de canales** cuando el dispositivo
  expone más de 2 (caso de la tarjeta de audio del usuario en Windows).
- Volumen master en dB, con salida siempre al dispositivo por defecto del sistema.
- **Tono de prueba integrado** (oscilador + ruido rosa): permite verificar visualizador, volumen y
  ruta de salida sin depender del hardware físico, y hace el proyecto testeable sin el tocadiscos
  conectado. Barato de construir, alto valor para desarrollo y para QA manual.
- Dos carátulas (ver ADR — sistema de skins) más un tercer prototipo (MilkDrop) evaluado en
  Fase A y decidido para Fase B con datos reales.

## Qué queda fuera, explícitamente, y por qué

- **Grabación a WAV/FLAC:** no fue pedida como requisito de v1; queda documentada en
  `docs/ROADMAP.md` como candidata natural dado que el usuario tiene grabador de CD/DVD/BR y
  probablemente quiera digitalizar vinilos antes de quemarlos. Añadirla ahora habría expandido el
  alcance del motor Rust (buffer de escritura a disco, detección de silencio para cortes de pista)
  sin confirmación explícita.
- **Ecualizador de 3 bandas y balance L/R:** encajaría con la estética de consola y es barato en
  Rust (biquads), pero no fue pedido. Documentado en el roadmap.
- **Salida de audio independiente del sistema** (monitoreo propio, distinto del dispositivo por
  defecto del SO): mencionado explícitamente por el usuario como iteración futura a documentar, no
  a construir ahora. Ver `docs/ROADMAP.md` — la arquitectura de Fase B ya lo deja casi trivial
  (el stream de salida ya es reconstruible; basta con no seguir el dispositivo por defecto).
- **Soporte Linux:** mencionado por el usuario como algo a evaluar después. Documentado con su
  fricción conocida (WebKitGTK, ALSA/PipeWire vía cpal) en el roadmap.

## Consecuencia

El motor de Fase B se diseña sabiendo que grabación y EQ son extensiones probables, pero no se
construyen puntos de extensión especulativos para ellas más allá de mantener el núcleo realtime
pequeño y bien encapsulado (ver CLAUDE.md, regla de contención en `audio/passthrough.rs`).
