# ADR 0002 — Presupuesto de latencia y el riesgo de filtro de peine

**Estado:** aceptada — 2026-08-14

## Contexto

El montaje real del usuario: el tocadiscos tiene salida RCA (a una tarjeta de audio en el PC con
Windows) y salida USB (a la Mac). En la mayoría de tocadiscos USB (Audio-Technica LP60X/LP120X,
Sony PS-LX310, la mayoría de los "suitcase") **la salida RCA y la USB están activas
simultáneamente** — el ADC USB toma una derivación de la misma señal analógica, sin conmutación.
Esto importa porque si alguna vez se escuchan ambas salidas a la vez (altavoz conectado al RCA y
salida de la computadora en la misma habitación), la mezcla de la misma señal con un retardo
produce un **filtro de peine**: coloración metálica y hueca, con nulos espaciados en `1/Δ` Hz.

## Las franjas perceptuales del retardo

| Retardo | Percepción |
|---|---|
| < 2 ms | Coloración tímbrica pura ("hueco", "de fase") |
| 5–20 ms | Efecto Haas: se fusiona en un solo sonido, pero con coloración clara y desplazamiento de imagen estéreo |
| **25–45 ms** | **Frontera: ni se fusiona limpio ni se separa; se percibe como duplicación y emborronamiento** |
| > 60 ms | Eco discreto, dos eventos separados |

Electron aterriza en 25–45 ms — **justo la peor franja posible**. Rust/CoreAudio deja la latencia
en ~5–10 ms: sigue coloreando, pero se fusiona como un solo sonido (ya en terreno del efecto
Haas), que es sensiblemente menos molesto.

## Asimetría entre plataformas

- **macOS (CoreAudio):** ~5–10 ms alcanzables. La ventaja de Tauri sobre Electron aquí es de otra
  categoría (25–45 ms → 5–10 ms).
- **Windows (WASAPI en modo compartido):** el periodo mínimo típico ronda los 10 ms, así que el
  resultado realista es ~20–30 ms de ida y vuelta frente a los ~25–45 ms de Electron — mejora
  real pero modesta, no espectacular.
- **ASIO en Windows** bajaría el techo a niveles comparables a macOS, pero un tocadiscos USB no
  trae driver ASIO. La tarjeta de audio del usuario en el PC, sin embargo, probablemente sí —
  queda documentado como iteración futura en `docs/ROADMAP.md`, no en la v1, porque complica el
  build de Windows (SDK propio, típicamente ASIO4ALL).

## Honestidades aceptadas explícitamente

1. **Ninguna latencia por software es "segura" si se mezclan ambos caminos.** Incluso a 8 ms hay
   un peine con nulos cada 125 Hz, audible. La única solución real es no reproducir ambas salidas
   a la vez; el software solo reduce el daño, no lo elimina. No existe compensación posible por
   software porque el camino RCA es analógico, fuera del control de la aplicación.
2. **Ya existe un retardo fuera de control** por simple propagación acústica (p. ej. ~6 ms si los
   altavoces del RCA están a 3 m y los de la computadora a 1 m). Cualquier presupuesto de latencia
   vive dentro de ese contexto — no tiene sentido perseguir 0 ms exactos.
3. **Mitigación de hardware disponible hoy:** muchas tarjetas de audio (Focusrite, Behringer,
   MOTU, Presonus) traen una perilla de *direct monitor* que enruta la entrada analógica a la
   salida con latencia cero real, sin pasar por la computadora. Si la tarjeta del usuario en
   Windows la tiene, resuelve el problema mejor que cualquier software, y ahí la app pasa a ser
   sobre todo visualizador y control de volumen. Documentado como nota operativa en
   `docs/hardware/montaje-del-usuario.md`.

## Decisión

Se acepta Rust/`cpal` como motor (ver ADR 0001) con el objetivo de mantener la latencia de
ida y vuelta lo más baja que la plataforma permita razonablemente en modo compartido, se expone la
latencia real medida en la interfaz (parte del `EngineState`), y se deja el tamaño de buffer
configurable para que el usuario pueda ajustarla si algún día la nota.
