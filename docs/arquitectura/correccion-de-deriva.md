# Corrección de deriva de reloj — la parte más delicada del proyecto

## El problema

El dispositivo de entrada (tocadiscos / tarjeta de audio) y el dispositivo de salida (la salida
del sistema) son **dos piezas de hardware distintas con cristales de reloj distintos**. Aunque
ambos declaren operar a 48 000 Hz, en la práctica difieren en algo entre 10 y 100 ppm (partes por
millón) — es una limitación física de fabricación de osciladores, no un defecto de ningún
dispositivo en particular.

A 50 ppm de desajuste se acumulan aproximadamente 4 muestras de diferencia por segundo. En una
cara de LP de ~22 minutos, eso son unas 5 000 muestras de desfase acumulado. Sin corrección, el
ring buffer que conecta entrada y salida (ver `motor-de-audio.md`) termina desbordándose o
vaciándose, produciendo un **clic audible** cada pocos minutos — justo el tipo de fallo que
arruina la experiencia en el momento en que el usuario está más relajado, escuchando de fondo.

## La solución: resampler de ratio variable gobernado por el nivel del buffer

Se usa `rubato` para resamplear el flujo de audio con un ratio que **no es fijo**: se ajusta
continuamente según cuán lleno está el ring buffer de entrada (el "A" del diagrama en
`motor-de-audio.md`), mediante un controlador PI (proporcional + integral):

```
error = llenado_actual − 0.5
corrección = −(Kp·error + Ki·∫error), acotada a ±0,5%
ratio_relativo = 1 + corrección
```

`llenado_actual` es la fracción de ocupación del ring buffer A (0 = vacío, 1 = lleno); el
objetivo es mantenerlo cerca de 0.5, con margen simétrico para absorber variaciones en ambas
direcciones. El término proporcional reacciona a la desviación actual; el término integral
corrige el sesgo acumulado a lo largo del tiempo (la deriva constante que causa el problema en
primer lugar).

**El signo del error es intencional y fácil de invertir por accidente** — documentado en detalle
en `audio/drift.rs` (`DriftController`), aquí el resumen: el resampler corre en modo
`FixedAsync::Output` (tamaño de salida fijo, ver `motor-de-audio.md`), y en ese modo **subir el
ratio hace que se consuma MENOS entrada** por bloque de salida. Entonces, si el buffer A está
demasiado lleno (`error > 0`, entra más rápido de lo que se drena), hay que **bajar** el ratio
para consumir más y drenarlo — la corrección es negativa cuando el error es positivo. Los tests
de `audio::drift::tests` verifican esto explícitamente (`buffer_demasiado_lleno_baja_el_ratio`,
`buffer_demasiado_vacio_sube_el_ratio`), además de una simulación de 50 ppm de deriva sostenida
que confirma que el llenado converge cerca de 0.5 en vez de divergir.

**El ajuste está acotado a ±0,5%** (`max_correction` en `DriftController::new`). Ese límite es
intencional: dentro de ese rango, un cambio de velocidad de reproducción es inaudible para el
oído humano en música. Ir más allá del límite significaría que algo más grave está pasando
(dispositivo desconectado, deriva anormalmente alta) y en ese caso el sistema debe tratarlo como
un error, no seguir estirando el ratio. El término integral tiene además un límite propio
(anti-windup) para que un underrun sostenido al arrancar no sature la corrección y la deje lenta
para reaccionar después.

Ganancias usadas (`Kp = 0.02`, `Ki = 0.002`): conservadoras a propósito — un desajuste de reloj
típico es una perturbación lenta (10-100 ppm), no hace falta reaccionar rápido, hace falta no
oscilar ni nunca sonar. `resampler.set_resample_ratio_relative(ratio_relativo, true)` se llama en
cada bloque de salida (~10 ms a 48 kHz con `OUTPUT_CHUNK_FRAMES = 512`); el `true` final le pide
a `rubato` rampear el cambio dentro del propio bloque en vez de saltarlo de golpe.

## Un beneficio adicional, gratis

El mismo mecanismo resuelve, sin código adicional, el caso — muy probable dado el hardware del
usuario — de que el dispositivo de entrada opere a una tasa de muestreo distinta de la salida
(p. ej. un ADC de tocadiscos a 44.1 kHz contra una salida del sistema a 48 kHz). El resampler ya
tiene que convertir de todos modos; que la conversión de tasa base sea 44.1→48 en vez de 48→48
no cambia el diseño.

## Por qué esto se documenta aparte y con este nivel de detalle

Es, con diferencia, el punto de mayor riesgo técnico del proyecto (ver ADR 0001, sección de costo
aceptado) y el que menos se parece a "código de aplicación" normal: es DSP de tiempo real donde un
ajuste mal calibrado degrada el audio de forma sutil — no con un error visible, sino con clics
esporádicos difíciles de reproducir en pruebas cortas. La verificación manual de este componente
específicamente requiere **dejar la app sonando 30+ minutos seguidos** y revisar los contadores de
underrun/overrun (ver la tabla de verificación del proyecto) — una prueba corta no lo detecta.

**Estado de la verificación:** la matemática del controlador está probada de forma aislada
(`cargo test`, ver arriba) contra escenarios sintéticos de deriva conocida. Lo que esos tests
**no** prueban es el sistema completo con hardware real — un tocadiscos de verdad, un desajuste
de reloj real, 30+ minutos reales. Esa verificación no se pudo hacer en el entorno donde se
escribió este motor (sin tocadiscos ni salida de audio disponibles) y queda pendiente para
cuando el usuario la corra en su propia máquina — ver la tabla de verificación del proyecto.
