# ADR 0011 — Servidor Docker en LAN para pruebas multidispositivo (Etapa 1: HTTP plano)

**Estado:** aceptada — 2026-08-23

## Contexto

Edward tiene un servidor privado en su red local (sin salida a internet) y quiere servir ahí la
versión web de desarrollo de Nostalgia, para poder probarla desde cualquier dispositivo de la LAN
sin instalar Node/pnpm/Tauri en cada uno. Esto también mitiga, por ahora, la fricción de Linux que
ya documenta `docs/ROADMAP.md`: Tauri en Linux usa WebKitGTK (el webview más flojo de los tres
soportados) y `cpal` habla ALSA a través de una capa de compatibilidad con PipeWire/PulseAudio que
añade latencia adicional. En vez de instalar el toolchain nativo de Tauri en un dispositivo Linux
solo para *ver* la app, ese dispositivo simplemente abre un navegador.

Esto ya es viable con la arquitectura actual, sin tocar código de producto: `app/src/main.ts`
elige el motor de audio en runtime — si `isTauri()` es falso usa `WebAudioEngine`
(`app/src/core/engine-web.ts`), que captura audio con `getUserMedia`/Web Audio **en el navegador
cliente**. El contenedor Docker nunca toca hardware de audio: solo sirve el build estático del
frontend (`app/dist`, generado por `pnpm build`). El motor Rust nativo (`passthrough.rs`/
`drift.rs`, sobre `cpal`) queda fuera de este alcance por completo — necesita acceso directo al
hardware de audio del sistema operativo host, algo que un contenedor Docker no ofrece de forma
estándar, y no es lo que se busca aquí.

Restricción que condiciona todo el diseño: `getUserMedia` exige un "contexto seguro" (HTTPS, o
`http://localhost`). Servir por `http://<ip-lan>:<puerto>` es HTTP plano sobre IP y no cumple esa
condición. Como el servidor no tiene salida a internet — no puede pedir un certificado público de
una CA reconocida —, el trabajo se divide en dos etapas:

- **Etapa 1 (este ADR, implementada):** HTTP plano. Cada navegador cliente se lanza con la
  bandera `--unsafely-treat-insecure-origin-as-secure` para permitir el micrófono. Medida
  temporal, documentada como tal.
- **Etapa 2 (futura, solo trazada aquí, no implementada):** HTTPS con una CA local vía
  `tls internal` de Caddy, instalando la CA raíz una vez en cada dispositivo cliente.

También decidido: build estático + reconstrucción manual del contenedor cuando haya cambios que
probar en otros dispositivos, sin hot-reload distribuido. El día a día de desarrollo sigue siendo
`pnpm dev` local en la máquina del desarrollador — este contenedor no lo sustituye.

## Alternativas consideradas

### Instalar Node/pnpm nativamente en cada dispositivo cliente
Descartada: reproduce el problema que se busca evitar — N máquinas con Node/pnpm que hay que
mantener, riesgo de deriva de versión frente a la máquina de desarrollo, y en la práctica sería
correr `pnpm dev` (con HMR involuntario en dispositivos que no son de desarrollo) o
`pnpm build && pnpm preview` a mano en cada uno.

### Exigir el build nativo Tauri en cada dispositivo (incluido Linux)
Descartada para este objetivo: `docs/ROADMAP.md` ya documenta que Linux es la plataforma con más
fricción esperada para el build nativo (WebKitGTK más flojo de los tres webviews soportados; cpal
habla ALSA con PulseAudio/PipeWire vía capa de compatibilidad, con latencia adicional conocida).
Instalar todo el toolchain nativo de Tauri en cada dispositivo solo para "verlo" es desproporcionado
— el motor de audio real de esos dispositivos, de todos modos, sería `WebAudioEngine` si no corren
dentro de Tauri.

### Servir directamente con Node (`vite preview` o `serve`), sin contenedor
Descartada: acopla el servidor privado a tener Node instalado de forma persistente y no aísla el
proceso del resto del sistema. Docker da una imagen versionada e inmutable, evitando "funciona en
el servidor pero no en el contenedor de otra persona".

### nginx:alpine como servidor estático
Evaluada seriamente — comparable en tamaño de imagen a Caddy (ambas del orden de 40-55 MB con la
base Alpine). Descartada porque la Etapa 2 (TLS con CA local) exigiría montar `mkcert`/`step-ca` a
mano y gestionar certificados como volumen; con nginx no hay forma nativa de que el propio servidor
sea su CA. Caddy resuelve eso con la directiva `tls internal`: una CA interna que Caddy mismo genera
y renueva, sin herramientas externas. Se prefiere no migrar de servidor entre la Etapa 1 y la
Etapa 2 — elegir Caddy desde ya evita pagar ese costo de migración dos veces.

### Traefik u otro reverse proxy dinámico
Descartada: pensado para topologías con varios servicios y descubrimiento vía labels de Docker.
Aquí hay un único servicio estático — sería sobre-ingeniería para el problema actual.

## Decisión

Caddy 2.9 (imagen `caddy:2.9-alpine`) como servidor estático, en un único servicio de
`docker-compose`, construido con un Dockerfile multi-stage: stage `builder` sobre
`node:22-alpine` (misma major que el entorno de desarrollo, v22.20.0) con `pnpm install
--frozen-lockfile` + `pnpm build`, y stage `runtime` que solo copia `app/dist` y el `Caddyfile`
sobre la imagen de Caddy. Servido por HTTP plano en el puerto 8080 del host de la LAN.

Archivos: `app/docker/Dockerfile`, `app/docker/docker-compose.yml`, `app/docker/Caddyfile`,
`app/.dockerignore`. Instrucciones operativas de uso en `docs/guias/despliegue-docker-lan.md`
(procedimiento ya decidido, no una decisión — de ahí que viva en `docs/guias/` y no como README
dentro de `app/docker/`, siguiendo el mismo criterio ya aplicado en
`docs/guias/build-y-empaquetado.md`).

## Números concretos

- Build estático servido: 1.0 MB (`app/dist`, medido en este entorno).
- `node_modules` del stage `builder`: 172 MB — descartado íntegro, nunca viaja a la imagen final
  (multi-stage build).
- `pnpm-lock.yaml`: 32 KB.
- Tamaño de la imagen final: **pendiente de medir** con `docker images nostalgia-web` en el
  servidor real (estimado 45-55 MB para `caddy:2.9-alpine` + ~1 MB de `dist/`, sin confirmar
  todavía en ese entorno).
- Tiempo de build del stage `builder`: **pendiente de medir** en el servidor real (depende de la
  caché de pnpm/Docker disponible ahí).

## Riesgos conocidos

- **Bandera insegura del navegador** (`--unsafely-treat-insecure-origin-as-secure=http://<ip>:<puerto>`)
  necesaria en cada dispositivo cliente, porque HTTP plano sobre IP de LAN no es "contexto seguro"
  para `getUserMedia`. La bandera está acotada al origen exacto declarado — no relaja la política
  de seguridad de otros orígenes — pero exige lanzar el navegador con flags personalizadas en cada
  dispositivo, lo cual es fricción de UX y fácil de perder tras un reinicio o una actualización del
  navegador si no se deja documentado un acceso directo.
- **Ausencia de TLS:** cualquier persona en la misma LAN puede leer o interferir el bundle
  JS/CSS servido (un MITM local es técnicamente posible). El audio en sí **nunca viaja por la
  red** en este diseño — `getUserMedia` vive enteramente en el navegador cliente, el contenedor
  jamás recibe ni procesa audio — así que el riesgo real es sobre la integridad del código
  servido, no sobre datos de audio.
- **Sin autenticación:** cualquier dispositivo en la LAN con la IP:puerto correctos accede sin
  login. Aceptado porque es un servidor privado local sin salida a internet, según lo declarado
  por el usuario — el perímetro de confianza es la LAN misma.

## Qué se sacrifica

- **HMR entre dispositivos:** cada cambio que se quiera probar en otro dispositivo requiere
  `docker compose up --build` manual — latencia de iteración de minutos, no los milisegundos de
  Vite HMR. El desarrollo día a día sigue siendo `pnpm dev` local; este contenedor es solo para
  "que alguien más lo vea desde otro dispositivo".
- **Aislamiento de red:** el puerto 8080 del contenedor queda expuesto a toda la LAN salvo que se
  restrinja aparte a nivel de firewall/interfaz — no hay tal restricción en esta Etapa 1.
- **Consistencia de versión de Node entre la imagen y la máquina de desarrollo:** `app/package.json`
  no declara `engines`, así que nada impide que la imagen (`node:22-alpine`) y la máquina de
  desarrollo diverjan de major con el tiempo sin que nada lo señale. Queda fuera del alcance de
  este ADR añadir ese guardarraíl, pero se deja anotado como recomendación futura.

## Trabajo futuro (Etapa 2, no implementada aquí)

Sustituir el bloque `:80 { ... }` de `app/docker/Caddyfile` por uno con `tls internal`, e instalar
la CA raíz que Caddy genera una sola vez en cada dispositivo cliente. Esto elimina la necesidad de
la bandera insegura del navegador, dando un contexto seguro real para `getUserMedia`. No se
implementa en este ADR porque primero se quiere validar que la Etapa 1 funciona end-to-end (ver
verificación en el plan de esta sesión) antes de invertir en la CA local.
