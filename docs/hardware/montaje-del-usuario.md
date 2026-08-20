# El montaje real del usuario

Este documento existe porque varias decisiones de arquitectura (selector de par de canales,
prioridad de la corrección de deriva, prioridad de la latencia) son consecuencia directa de cómo
está conectado el equipo real, no de un caso genérico de "un tocadiscos con salida USB".

## El equipo

- **Tocadiscos de vinilo** con salida USB y salida RCA. En la mayoría de tocadiscos USB de este
  tipo (Audio-Technica LP60X/LP120X, Sony PS-LX310, la mayoría de los "suitcase"), **ambas
  salidas están activas simultáneamente** — el ADC USB toma una derivación de la misma señal
  analógica, sin conmutación. Se asume ese comportamiento salvo que el usuario confirme lo
  contrario.
- **Lector/grabador de CD/DVD/BR**, mencionado por el usuario como parte de su equipo de escucha,
  y como motivación para considerar en el futuro digitalizar vinilos y grabarlos — ver
  `docs/ROADMAP.md`. No es parte del alcance funcional de la v1 (ver ADR 0004).

## La topología de conexión

```
                    ┌─────────────┐
                    │  Tocadiscos  │
                    └──────┬──────┘
              RCA ─────────┤─────────── USB
               │                            │
               ▼                            ▼
      ┌──────────────────┐        ┌──────────────┐
      │  Tarjeta de audio  │        │      Mac      │
      │  (PC con Windows)  │        │  (desarrollo) │
      │  posiblemente      │        └──────────────┘
      │  4/8+ canales de   │
      │  entrada           │
      └──────────────────┘
```

- **Windows:** el tocadiscos entra por RCA a una tarjeta de audio externa, que puede exponer más
  de 2 canales de entrada simultáneos. Esto es lo que obliga al selector de par de canales (ver
  `docs/arquitectura/dispositivos.md`) — sin él, la app sería inutilizable en esta máquina tal
  como está conectada.
- **macOS:** el tocadiscos entra directo por USB, exponiendo típicamente un par estéreo simple. Es
  la máquina de desarrollo.

## Por qué esto no es un caso hipotético de latencia

Como ambas salidas del tocadiscos (RCA y USB) pueden estar activas a la vez, existe la posibilidad
real de que en algún momento suenen simultáneamente un altavoz conectado por RCA y la salida de
audio de una de las computadoras en la misma habitación. Esa posibilidad —confirmada por el
usuario como algo que no puede descartar— es la que eleva la latencia de "detalle técnico menor" a
"criterio de decisión de stack" en el ADR 0001 y motiva el análisis completo del ADR 0002.

## Nota operativa para el usuario

Vale la pena revisar si la tarjeta de audio del PC con Windows tiene una perilla de **direct
monitor**. Si la tiene, resuelve el problema de latencia mejor que cualquier solución de software
(latencia cero real, por hardware, sin pasar por la computadora), y en ese caso la aplicación pasa
a ser sobre todo visualizador y control de volumen en esa máquina. Esto no cambia ninguna decisión
de arquitectura — el motor se construye igual — pero cambia cuánto importa en la práctica diaria.
