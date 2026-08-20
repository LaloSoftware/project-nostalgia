# ADR 0001 — Stack: Tauri v2 + Rust, no Electron

**Estado:** aceptada — 2026-08-14

## Contexto

Nostalgia debe correr en Mac y Windows como monitor de línea para un tocadiscos USB. El caso de
uso dominante no es "abrir la app y usarla activamente": es dejarla sonando **de fondo mientras se
trabaja en otra cosa**, potencialmente demandante para el equipo. Eso convierte el consumo de
recursos en reposo (ventana minimizada u oculta) en el criterio más importante, por encima del
tamaño del instalador o la velocidad de desarrollo.

## Alternativas consideradas

### Electron + Web Audio

El motor de audio vive en Chromium: `getUserMedia` para la entrada, `GainNode` para el volumen,
`AnalyserNode` para las ondas, y el destino sigue automáticamente la salida por defecto del
sistema. La futura "salida de audio independiente del sistema" sería literalmente
`audioContext.setSinkId()`. Visualización a 60 fps sin IPC.

Descartada como motor final porque:
- Instalador de ~120–180 MB.
- Latencia medida en la práctica de **25–45 ms**, que cae justo en la peor franja perceptual de
  un filtro de peine (ver ADR 0002) si algún día suenan a la vez la salida RCA y la digital.
- El audio vive **dentro** del webview de Chromium. Ocultar o cerrar la ventana no libera el
  renderer: el piso de memoria de Chromium (~140–180 MB) es inevitable incluso en reposo.

### App web pura, sin instalar

Mismo motor Web Audio pero corriendo en una pestaña de Chrome. Cero instalación, funciona igual
en Mac y Windows.

Descartada como entrega final porque no se siente "una app" (sin ventana propia, sin bandeja, sin
persistencia de permisos entre sesiones), pero **adoptada como fase de desarrollo** — ver ADR 0003.

### Tauri v2 + Rust (`cpal`) — elegida

Binario de ~10–15 MB y audio nativo de baja latencia (CoreAudio / WASAPI).

## Comparativa medida (estimaciones basadas en el comportamiento conocido de cada runtime)

| Escenario | Electron | Tauri + Rust |
|---|---|---|
| Ventana visible, sonando | ~150–200 MB, CPU 3–10% | ~85–135 MB, CPU 3–10% |
| Minimizada / oculta | ~140–180 MB, CPU ~1% | **~15–25 MB, CPU <1%** |

Con la ventana abierta la diferencia es de apenas ~80 MB de RAM y casi nada de CPU — no es el
argumento decisivo. La diferencia grande está en la fila "minimizada", que es justo el caso de uso
dominante de este proyecto.

## Por qué la diferencia es arquitectónica y no un detalle de configuración

En Tauri los streams de audio (`cpal`) viven en el proceso Rust, **completamente independientes
del webview**. Eso permite destruir la ventana al minimizar a la bandeja y quedarse con un proceso
de ~20 MB que solo ejecuta un callback de audio (ver ADR 0005). En Electron el audio vive dentro
de Chromium, así que nunca se puede bajar del piso de memoria de Chromium: ocultar la ventana no
libera el renderer que sostiene el audio.

## Costo aceptado de esta decisión

- El equipo de desarrollo (Edward) no domina Rust. Mitigación: todo el código de tiempo real se
  aísla en un módulo pequeño y muy comentado (`app/src-tauri/src/audio/`), con una superficie
  mínima (`start`, `set_gain_db`, `frame`), de modo que el grueso de los ajustes futuros ocurra en
  TypeScript, en la capa de carátulas.
- `cpal` no ofrece lo que Web Audio da gratis: seguimiento automático del dispositivo de salida
  por defecto, corrección de deriva de reloj entre dispositivos, ni notificación de cambios de
  dispositivo. Todo eso se construye a mano (ver `docs/arquitectura/`).
- En Linux, Tauri usa WebKitGTK, el más flojo de los tres webviews soportados; Electron llevaría su
  propio Chromium y sería más predecible ahí. Aceptado porque Linux es soporte futuro, no v1
  (ver `docs/ROADMAP.md`).

## Consecuencia

Se construye en dos fases (ver ADR 0003): primero el frontend con Web Audio en el navegador para
separar el riesgo de diseño del riesgo de DSP, después se sustituye el motor por Rust sin tocar
las carátulas.
