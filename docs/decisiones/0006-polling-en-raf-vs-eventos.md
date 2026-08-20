# ADR 0006 — Polling en `requestAnimationFrame` en vez de eventos Rust→JS a 60 Hz

**Estado:** aceptada — 2026-08-14

## Contexto

En la Fase B (motor Rust), el visualizador de las carátulas necesita datos de audio (picos, RMS,
osciloscopio, espectro) a una cadencia cercana a 60 Hz para animar con fluidez. Hay dos formas
razonables de llevar esos datos del proceso Rust al webview.

## Alternativas consideradas

### Rust emite eventos a 60 Hz (`window.emit`)

El backend empuja un evento con el `AudioFrame` calculado cada ~16 ms, sin que el frontend lo
pida.

Descartada porque:
- El backend tendría que saber si hay una ventana escuchando o no, y desactivar el temporizador
  cuando no la hay — lógica adicional para replicar algo que el navegador ya resuelve.
- No hay garantía de sincronía con el refresco real de pantalla del lado del frontend; se puede
  terminar emitiendo frames que nunca se pintan, o pintando con jitter si el temporizador de Rust
  y el `rAF` del navegador no están alineados.

### Polling desde `rAF` con `invoke('get_frame')` — elegida

El frontend, dentro de su propio bucle `requestAnimationFrame`, pide el frame más reciente en cada
iteración. Rust simplemente mantiene un `Mutex<AudioFrame>` actualizado por el hilo de análisis
(no realtime) y responde a la consulta.

## Por qué se prefiere

1. **Se sincroniza naturalmente con el refresco de pantalla real**, porque quien decide la
   cadencia es el propio `rAF` del navegador, no un temporizador en Rust adivinando la tasa de
   refresco.
2. **Con la ventana cerrada, el tráfico IPC es exactamente cero.** Nadie llama a `get_frame`
   porque no hay `rAF` corriendo — no hace falta que Rust sepa si hay una ventana viva o no. Esto
   es consistente con y refuerza directamente el ADR 0005: la app en bandeja no gasta ciclos
   generando eventos que nadie recibe.
3. Es más simple: Rust no necesita gestionar el ciclo de vida de un temporizador de emisión ni
   coordinarlo con la apertura/cierre de la ventana.

## Costo aceptado

Cada `invoke` tiene un costo fijo de IPC ligeramente mayor que recibir un evento ya empujado, pero
a 60 Hz con un payload pequeño (`AudioFrame` es unos pocos floats más buffers cortos) es
insignificante frente a la ganancia de simplicidad y a la garantía de tráfico cero en reposo.
