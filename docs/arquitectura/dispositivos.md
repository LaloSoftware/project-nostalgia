# Manejo de dispositivos de audio

**Implementado**, con dos correcciones importantes sobre el diseño original de la Fase 0 —
marcadas explícitamente más abajo. Se dejan ambas versiones (qué se planeó y qué se construyó)
en vez de borrar el rastro, porque el motivo del cambio es información real: `cpal` 0.18 resultó
tener una capacidad (`DeviceId` estable) que no se conocía al diseñar, y la reconexión automática
de entrada resultó ser más trabajo del que cabía en esta pasada — mejor decirlo que fingir que
está hecho.

## El problema: `cpal` no notifica cambios

A diferencia de Web Audio (que en el navegador notifica cambios de dispositivos de forma nativa),
`cpal` **no ofrece un callback multiplataforma de "se conectó/desconectó algo" ni de "cambió el
dispositivo por defecto"**. Todo lo que Web Audio da gratis en la Fase A hay que construirlo a
mano en la Fase B — es uno de los costos aceptados explícitamente en el ADR 0001.

## La solución: un hilo de vigilancia

Un hilo dedicado (`devices::spawn_output_watcher`), separado de los callbacks de audio en tiempo
real (ver la regla de "cero I/O en el callback" en `motor-de-audio.md`), sondea cada ~1,5
segundos el `DeviceId` (ver más abajo) del dispositivo devuelto por `default_output_device()`.

**Si cambia la salida por defecto** (el caso más común en el día a día: enchufar audífonos,
conectar un altavoz Bluetooth), se llama a `Engine::on_output_device_changed()`, que reconstruye
**solo** el lado de salida — nuevo stream, nuevo hilo de resampleo, nuevo hilo de análisis —
recuperando la propiedad del ring buffer A del hilo de resampleo viejo antes de dárselo al nuevo
(ver `docs/decisiones/0008-hilo-dedicado-de-resampleo.md`), de modo que **el stream de entrada
nunca se toca ni se corta**. Esto sí quedó implementado tal como se planeó en la Fase 0.

**Si el dispositivo de entrada desaparece** (se desconecta el tocadiscos), el callback de error de
`cpal` lo detecta y lo registra (`log::error!`) — pero, a diferencia de lo que decía la versión
original de este documento, **hoy no hay reconexión automática**. El motor simplemente deja de
recibir audio de ese stream hasta que el usuario vuelva a seleccionar el dispositivo (o uno nuevo)
desde la UI. Implementar la reconexión automática real (vigilar la reaparición del dispositivo y
volver a llamar a `Engine::start()` con el mismo `device_id` y `channel_pair`) es sencillo de
describir pero no se construyó en esta pasada — queda anotado en `docs/ROADMAP.md`.

## Persistencia de la selección: por `DeviceId`, no por nombre

**Corrección sobre el diseño original:** la Fase 0 asumió que `cpal` no da identificadores
estables (cierto en versiones anteriores del crate) y diseñó la persistencia por nombre con
coincidencia por prefijo. La versión de `cpal` realmente instalada (0.18.1) expone un
`DeviceId` documentado como estable "across program runs, device disconnections, and system
reboots where possible" (`DeviceTrait::id()`), más `HostTrait::device_by_id()` para resolverlo de
vuelta a un `Device`. Se usa como identificador primario:

1. `AudioDeviceInfo.id` es el `DeviceId` serializado a texto (`DeviceId: Display + FromStr`), no
   un nombre — el nombre visible vive aparte en `AudioDeviceInfo.label`, solo para mostrar en el
   selector del shell.
2. `find_input_device()` intenta primero interpretar el string guardado como `DeviceId` real.
3. Si eso no resuelve (p. ej. el string se guardó con una versión de cpal distinta, o el
   dispositivo cambió de forma que invalida el ID), cae a comparar contra el nombre visible —
   la estrategia de respaldo, ya no la primaria.

El selector de par de canales (más abajo) no se ve afectado por este cambio: sigue funcionando
igual, solo cambia qué string identifica al dispositivo.

## Selector de par de canales

El dispositivo de entrada del usuario en Mac (el tocadiscos vía USB) expone 2 canales. El
dispositivo de entrada en Windows (una tarjeta de audio recibiendo la salida RCA) puede exponer
4, 8 o más canales de entrada simultáneos. Por eso el contrato de selección de dispositivo incluye
no solo *qué dispositivo* sino *qué par de canales* usar dentro de él:

- Si el dispositivo expone exactamente 2 canales, el selector de par se oculta — no tiene sentido
  mostrarlo cuando no hay nada que elegir.
- Si expone más de 2, el selector de par aparece, mostrando el conteo de canales que `devices.rs`
  expone como parte de la información del dispositivo.

Esta es una consecuencia directa del montaje real del usuario — ver
`docs/hardware/montaje-del-usuario.md` — y no un caso hipotético: sin este selector, la app sería
inutilizable en el PC con Windows tal como está conectado hoy.
