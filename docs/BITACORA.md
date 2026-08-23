# Bitácora

Registro cronológico del proceso de desarrollo. Una entrada por sesión de trabajo relevante:
qué se hizo, qué se decidió, qué quedó pendiente y por qué.

---

## 2026-08-14 — Planeación inicial y andamiaje (Fase 0)

**Contexto de la sesión:** Edward planteó el requerimiento original (monitor de línea para
tocadiscos USB, multiplataforma, estética de reproductor antiguo con carátulas intercambiables).
Se hizo una fase de planeación en profundidad antes de escribir código.

**Se decidió:**
- Stack: Tauri v2 + Rust sobre Electron, por el escenario de "sonando de fondo mientras se
  trabaja en otra cosa" (ver ADR 0001).
- Orden de construcción: frontend con Web Audio primero, motor Rust después (ADR 0003).
- Alcance de v1: entrada + volumen + salida del sistema + tono de prueba, sin grabación ni EQ
  (ADR 0004).
- Dos carátulas comprometidas (Consola Digital, Hi-Fi de madera) más un tercer prototipo
  (MilkDrop vía `butterchurn`) evaluado en Fase A y decidido para Fase B con datos reales.
- Bandeja del sistema con ventana destruible como la característica que justifica la elección de
  stack (ADR 0005).
- Polling en `rAF` en vez de eventos Rust→JS a 60 Hz, para tráfico IPC cero en reposo (ADR 0006).
- pnpm con `minimumReleaseAge` y bloqueo de scripts de ciclo de vida, más el set concreto de
  dependencias de frontend (`dseg`, `@fontsource/*`, `culori`, `morphicons`, `lucide`, `motion`,
  `butterchurn`) (ADR 0007).
- Separación de la raíz en `CLAUDE.md` / `docs/` / `app/`, con directiva explícita de documentar
  cada decisión con el mismo nivel de detalle que esta conversación de planeación.

**Se hizo en esta sesión:**
- Estructura de la raíz creada: `CLAUDE.md`, `docs/{decisiones,arquitectura,guias,hardware}`,
  `app/` (vacía, pendiente de scaffold).
- Los 7 ADRs iniciales escritos, capturando el razonamiento completo de la planeación.
- Este archivo (`BITACORA.md`) y el índice `docs/README.md` creados.

**Pendiente para la siguiente sesión:**
- Completar `docs/arquitectura/` (visión general, contrato de datos, motor de audio, corrección
  de deriva, dispositivos), `docs/guias/` (permisos de plataforma; build y empaquetado y crear
  una carátula quedan para cuando haya algo real que documentar, ver ADR 0003) y
  `docs/hardware/montaje-del-usuario.md`.
- `docs/ROADMAP.md`.
- Scaffold de `app/` con Vite + TypeScript + pnpm (Fase A del plan).

---

## 2026-08-14 — Fase A completa: frontend con Web Audio y las tres carátulas

**Se hizo en esta sesión** (continuación directa de la anterior, mismo día):

- Cerrado todo `docs/` pendiente: `docs/arquitectura/` completo (visión general, contrato de
  datos, motor de audio, corrección de deriva, dispositivos), `docs/hardware/montaje-del-usuario.md`,
  `docs/ROADMAP.md`, y `docs/guias/crear-una-caratula.md` (escrita al final, con las tres
  carátulas ya construidas como referencia real — ver ADR 0003).
- Scaffold de `app/` con Vite + TypeScript vanilla, bajo pnpm con `.npmrc` endurecido
  (`minimum-release-age=1440`) creado **antes** de la primera instalación.
- `app/src/core/types.ts` escrito primero, como manda el ADR: `AudioFrame`, `EngineState`,
  `Skin`, `SkinManifest`, `SkinHostApi`. Se le añadió sobre la marcha `requiresPcm` (para
  carátulas tipo MilkDrop) y la vía de escape `getWebAudioNode?()` — documentada in situ como
  específica de Fase A, a resolver antes de que una carátula así entre al build nativo.
- Motor `engine-web.ts` sobre Web Audio: cadena `getUserMedia → inputSourceGain/testToneGain →
  masterGain → destination`, con taps de análisis (`AnalyserNode` por canal + uno mono para
  espectro), tono de prueba propio (`testtone.ts`, oscilador + ruido rosa vía Kellett), y
  conversión dB↔lineal en `core/gain.ts`.
- Las tres carátulas de la Fase A, construidas:
  - **Consola Digital**: canvas 2D (osciloscopio, espectro, medidores LED) + post-proceso WebGL2
    de un pase (`crt.frag`, escrito a mano) para el brillo de fósforo/scanlines/aberración;
    paleta de color generada en build time con `culori` interpolando en OKLCH
    (`scripts/generate-spectrum-palette.ts` → `palette.ts`, committeado); perilla con resorte
    real vía `motion/mini`; mute y fuente morfean con `morphicons` sobre datos de `lucide`.
  - **Hi-Fi de Madera**: deliberadamente sin canvas/WebGL/iconos del shell — agujas VU con
    balística real (media móvil exponencial, τ=300ms), fader deslizante e interruptores de
    palanca en CSS puro. Construida para probar que el contrato de carátulas no depende de las
    herramientas usadas por la primera.
  - **MilkDrop**: prototipo sobre `butterchurn`/`butterchurn-presets`, con `requiresPcm: true` y
    un subconjunto curado de 8 presets (nombres verificados contra el paquete instalado). Se
    detectó que arrastraba ~900 KB al bundle principal; se corrigió con `import()` dinámico
    (`registry.ts` acepta `createSkin(): Skin | Promise<Skin>`), dejando el bundle de arranque en
    ~50 KB y ese peso solo se paga si el usuario la selecciona.
- Shell (`ui/shell.ts` + `shell.css`): barra de carátulas, selector de dispositivo/par de
  canales/fuente, banner de errores de permiso. `main.ts` orquesta motor + registro de carátulas
  + persistencia (`core/settings.ts`, `localStorage`) + bucle de `rAF`.
- Dependencias añadidas a las ya decididas en el ADR 0007: `dseg`, `@fontsource/vt323`,
  `@fontsource/share-tech-mono`, `lucide`, `morphicons`, `motion`, `butterchurn`,
  `butterchurn-presets`, `culori`/`tsx` (dev). Se aprobó el `postinstall` de `esbuild`
  (necesario) y se dejó bloqueado el de `core-js` (solo un mensaje de patrocinio) — registrado en
  el ADR 0007.
- Verificado: `pnpm build` limpio (tsc sin errores + bundle de Vite), servidor de desarrollo
  sirviendo sin 404 en los recursos clave (fuentes, shader). **No se pudo verificar visualmente
  en un navegador real** — la extensión de Chrome de Claude no estaba conectada en este entorno;
  queda pendiente una verificación visual manual (ver tabla de verificación del plan).

**Pendiente para la siguiente sesión:**
- Verificación visual manual en Mac con el tocadiscos real conectado (toda la tabla de
  verificación del plan: escuchar audio real, mover volumen, tono de prueba, cambiar de
  carátula, MilkDrop con audio real).
- Fase B: motor nativo en Rust (`cpal`/`rtrb`/`rubato`/`rustfft`), incluyendo la decisión medida
  sobre el puente de PCM para MilkDrop.

---

## 2026-08-14 — Fase B: motor nativo en Rust, empaquetado y cierre de la sesión

**Contexto:** continuación directa de la Fase A, mismo día. La extensión de Chrome de Claude no
estaba disponible para verificación visual (pendiente de la sesión anterior), así que se avanzó
en paralelo con el motor Rust mientras el usuario prueba la Fase A por su cuenta.

**Se hizo en esta sesión:**
- `app/src-tauri` inicializado con `pnpm create tauri-app`/`tauri init --ci`, apuntando al
  frontend Vite existente. `tauri.conf.json` ajustado a mano: identifier, CSP, ventana `main`,
  `trayIcon`. `Info.plist`/`entitlements.plist` añadidos para el permiso de micrófono en macOS.
- Antes de escribir una sola línea de audio real, se verificó contra el código fuente
  descargado de cada crate (no de memoria) la API exacta de `cpal` 0.18, `rtrb` 0.3, `rubato` 5.0
  y `audioadapter-buffers` — varias firmas resultaron distintas de lo esperado
  (`SampleRate`/`ChannelCount` ahora son `u32`/`u16` planos, no tuplas; `DeviceTrait::name()` ya
  no existe, reemplazado por `id()`/`Display`). Encontrar esto último cambió una decisión de
  diseño para mejor — ver más abajo.
- Motor completo en `audio/`: `passthrough.rs` (callbacks realtime de entrada/salida, cero
  asignaciones/locks/IO), `drift.rs` (`DriftController` con 5 tests unitarios, más el hilo
  dedicado de resampleo — ver ADR 0008, un refinamiento real sobre el diagrama de la Fase 0),
  `analysis.rs` (FFT con ventana de Hann, picos/RMS/osciloscopio/espectro), `devices.rs`
  (enumeración y vigilancia de la salida por defecto), `testtone.rs` (mismo algoritmo de ruido
  rosa que la Fase A, para que suene igual). `mod.rs` expone `Engine`, con
  `on_output_device_changed()` reconstruyendo solo la salida sin cortar la entrada (recuperando
  la propiedad del ring buffer vía `.join()` del hilo de resampleo viejo).
- **Descubrimiento que cambió una decisión documentada:** `cpal` 0.18 expone `DeviceId` estable
  (`DeviceTrait::id()`, `HostTrait::device_by_id()`), algo que la Fase 0 no esperaba disponible.
  Se adoptó como identificador primario de dispositivo en vez de coincidencia por nombre —
  `docs/arquitectura/dispositivos.md` se corrigió para reflejarlo, en vez de dejar la
  documentación desactualizada.
- **Honestidad sobre alcance real vs. planeado:** la reconexión automática del dispositivo de
  entrada, que la Fase 0 daba por hecha, no se construyó — solo se detecta y se registra el
  error. Corregido en `docs/arquitectura/dispositivos.md` y anotado en `docs/ROADMAP.md` en vez
  de dejar la documentación afirmando algo que el código no hace.
- `commands.rs`/`state.rs`/`lib.rs`: superficie IPC completa, bandeja del sistema con menú
  (Mostrar/Silenciar/Salir), ventana destruible con `RunEvent::ExitRequested` +
  `api.prevent_exit()` (ver ADR 0005), `ActivationPolicy::Accessory` en macOS sin ventana.
  Verificado contra el código fuente de `tauri` 2.11 que los comandos de la app (no de plugins)
  no necesitan entradas en `capabilities/*.json` para contenido local — no se agregaron de más.
- `engine-tauri.ts`: mismo contrato `AudioEngine` que la Fase A, resolviendo la tensión real
  entre el `getFrame()` síncrono del contrato y el IPC asíncrono de Tauri con un patrón de
  "una consulta en vuelo como máximo, se devuelve la última recibida" — el propio bucle de rAF
  del host es el que hace de motor de polling, sin duplicar bucles.
- `main.ts` elige el motor en runtime con `isTauri()`; `engine-tauri.ts` se carga con `import()`
  dinámico para no meter el cliente de `@tauri-apps/api` en el bundle de la Fase A.
- **Verificado de verdad, no solo "debería compilar":**
  - `cargo check`/`cargo test --lib` limpios (5/5 tests de `DriftController` pasan; el primer
    intento de uno falló por un error de signo en el modelo de planta simulado del *test*, no en
    el controlador real — se detectó y corrigió).
  - `cargo build` (debug) enlaza contra CoreAudio/AudioToolbox sin error.
  - El binario debug se lanzó de verdad (`nohup ./target/debug/nostalgia`): proceso estable,
    ~116 MB, 0% CPU en reposo, `System Events` confirma una ventana visible real
    (`visible:true, background only:false`) — sin poder tomar una captura de pantalla (sin la
    extensión de Chrome), pero es la mejor señal disponible en este entorno de que arrancó bien.
  - `pnpm tauri build` genera un `.app` válido en modo release, con `NSMicrophoneUsageDescription`
    correctamente fusionado (confirmado con `plutil -p`). El paso del `.dmg` falló por un timeout
    de AppleScript hablándole a Finder (`-1712`) — diagnosticado como límite del entorno sin
    sesión de escritorio interactiva, no un error de configuración; documentado en
    `docs/guias/build-y-empaquetado.md` con el mensaje exacto.
  - De paso, se encontró y corrigió un warning real de Tauri: el identifier no puede terminar en
    `.app` (`com.nostalgia.app` → `com.nostalgia.desktop`).
- Documentación cerrada para esta fase: ADR 0008 (hilo de resampleo dedicado), actualización de
  `motor-de-audio.md`, `correccion-de-deriva.md` (convención de signos del controlador, con nota
  expresa de que la verificación con hardware real sigue pendiente) y `dispositivos.md`;
  `docs/guias/permisos-de-plataforma.md` y `docs/guias/build-y-empaquetado.md` escritas.

**Pendiente para la siguiente sesión:**
- Verificación con hardware real (tocadiscos, 30+ minutos, tabla de verificación completa del
  proyecto) — no se pudo hacer en este entorno sin el dispositivo ni salida de audio disponibles.
- Decidir el puente de PCM de MilkDrop para Fase B (evaluación documentada, no construida).
- Reconexión automática del dispositivo de entrada (ver `docs/ROADMAP.md`).
- Mensajes de error específicos para permiso de micrófono denegado en macOS/Windows del lado
  Rust (hoy llega el error crudo de `cpal`, sin traducir como sí ocurre en la Fase A).
- Build universal (`x86_64-apple-darwin` + `aarch64-apple-darwin`) y build/verificación en
  Windows — ninguno de los dos se pudo hacer en este entorno.

**Verificación visual de la Fase A: resuelta.** Edward probó `pnpm dev` en su propia Mac con el
tocadiscos real conectado — "parece funcionar perfectamente". Cierra el pendiente que había
quedado abierto por no tener la extensión de Chrome disponible en el entorno de desarrollo.

---

## 2026-08-15 — Bug real en MilkDrop encontrado y corregido; cierre de Fase C

**Contexto:** al probar la Fase A, Edward reportó que la carátula MilkDrop mostraba solo pantalla
negra con el botón de cambio de preset — no el comportamiento esperado.

**El bug, y por qué el primer intento de arreglo no bastó:**
- `butterchurn.createVisualizer(...)` fallaba en runtime con `is not a function`. La causa:
  `butterchurn` empaqueta su módulo con `__webpack_require__.r` + `.d(..., "default", ...)`
  (patrón de módulo transpilado a ES) DENTRO de un wrapper UMD — el resultado real es
  `{ __esModule: true, default: Butterchurn }`, no la clase directamente. El "default import"
  normal de Vite no lo desenvolvió.
- Primer arreglo (desenvolver un nivel de `.default`) seguía fallando con el mismo error —
  reportado por Edward. Investigando más a fondo, con `import * as ns`, `ns.default` da el
  objeto intermedio `{__esModule, default: Butterchurn}`, no la clase — hacía falta bajar UN
  NIVEL MÁS. Antes de aplicar el segundo arreglo, se verificó **empíricamente contra el módulo
  real** (`node -e` con un `window` stub, no otra suposición) que la versión corregida sí
  resuelve `createVisualizer` como función. Ver el commit a `skins/milkdrop/skin.ts`
  (`resolveButterchurnExport`, desenvuelve capas de `.default` hasta encontrar el objeto real,
  sin asumir una profundidad fija — para no romperse de nuevo si el empaquetado cambia).
- De paso: se blindó `mount()` con try/catch (antes, cualquier excepción ahí dejaba `visualizer`
  en `null` para siempre y todo se volvía un no-op silencioso vía optional chaining — pantalla
  negra sin ninguna pista) y se agregó liberación explícita del contexto WebGL de Consola
  Digital en `unmount()` (`WEBGL_lose_context`) — los navegadores limitan cuántos contextos
  WebGL viven a la vez, y sin esto alternar carátulas repetidamente podía agotar ese límite.
- **Pendiente:** Edward no confirmó todavía si el segundo arreglo ya funciona visualmente.

**Fase C, cerrada:**
- Build universal (`x86_64-apple-darwin` + `aarch64-apple-darwin`) verificado end-to-end: se
  instaló el target que faltaba, `pnpm tauri build --target universal-apple-darwin` compiló y
  enlazó ambas arquitecturas (`lipo -info` confirma `x86_64 arm64` en el mismo binario).
- El paso del `.dmg` volvió a fallar por el mismo timeout de AppleScript/Finder del entorno sin
  sesión de escritorio (ver la sesión anterior). Esta vez se encontró una solución real:
  `create-dmg` trae un flag `--skip-jenkins` pensado exactamente para CI/headless. `tauri build`
  no lo expone, así que se invocó `bundle_dmg.sh` directamente con ese flag, reusando el `.app`
  ya construido — produjo un `.dmg` de ~7.5 MB que monta, contiene el `.app` universal y el
  symlink de `Applications`, verificado con `hdiutil attach`. Documentado en
  `docs/guias/build-y-empaquetado.md` con el comando completo.
- Mensajes de error de `cpal` traducidos al español: `describe_cpal_error()` nuevo en
  `audio/mod.rs`, mapea `ErrorKind::PermissionDenied/DeviceNotAvailable/HostUnavailable/
  DeviceBusy/UnsupportedConfig` a mensajes accionables (con los pasos concretos de macOS/Windows
  para el caso de permiso denegado), aplicado en los 6 puntos donde `Engine::start()`/
  `rebuild_output_session()` pueden fallar por un error de `cpal`. Antes llegaba el mensaje
  crudo en inglés de cpal hasta el frontend.
- `docs/guias/permisos-de-plataforma.md` y `docs/guias/build-y-empaquetado.md` actualizadas para
  reflejar lo verificado (antes decían "no verificado"/"pendiente" en varios puntos que ya se
  resolvieron en esta sesión).

**Pendiente para la siguiente sesión:**
- Confirmación de Edward de que MilkDrop se ve bien tras el segundo arreglo.
- Verificación con hardware real (30+ minutos, tabla de verificación completa) — sigue
  pendiente, no se puede hacer sin el tocadiscos conectado a este entorno.
- Reconexión automática de entrada, puente de PCM para MilkDrop en Fase B, build/verificación en
  Windows — sin cambios desde la sesión anterior, ver `docs/ROADMAP.md`.

---

## 2026-08-19 — Integración a git y publicación del repositorio

**Contexto de la sesión:** el proyecto llevaba cuatro fases completas (0, A, B y C) sin estar
versionado. El `.git` existía con una rama `dev` que nunca recibió un commit, sin remoto, y los
87 archivos vivían solo como archivos sin rastrear en un disco. Edward pidió integrar todo a un
repositorio, con el trabajo en una rama de desarrollo y `main` limpia.

**Se hizo:**
- Identidad de git configurada con `--local` (no se tocó la configuración global de la máquina):
  `Eduardo Lemus Laguna <eduardo.lemus.laguna@gmail.com>`. Antes git inferría
  `edwardll@MacBook-Pro-de-Eduardo.local`, que GitHub no puede vincular a una cuenta.
- `.gitignore` de raíz creado, deliberadamente mínimo (`.DS_Store` y directorios de editores).
  `app/` y `app/src-tauri/` ya declaraban sus propias exclusiones y centralizarlas rompería la
  separación de dominios de CLAUDE.md.
- `main` creada con un único commit vacío y cero archivos; `develop` ramificada de ella, con el
  proyecto completo repartido en cinco commits temáticos (directivas, documentación, andamiaje
  Vite+Tauri, motor de audio en Rust, frontend y carátulas).
- La rama `dev` desapareció sola al crear `main`: una rama sin nacer no es una referencia real,
  no hubo nada que borrar.
- Remoto `origin` apuntando a `https://github.com/LaloSoftware/project-nostalgia.git`, que se
  verificó vacío (`git ls-remote` sin refs) antes de tocar nada — ninguna operación podía
  sobrescribir trabajo ajeno.

**Se decidió** (ADR 0009, nuevo):
- Dos ramas de larga vida con ancestro común, no rama huérfana: `--orphan` habría dado una
  `main` vacía sin el commit-artefacto, pero condenaría todo merge futuro a
  `--allow-unrelated-histories`. Se cambió un commit vacío permanente por evitar una fricción
  permanente peor.
- Commits temáticos en vez de un solo `Initial commit` de 87 archivos, para que `git log` diga
  algo sobre la estructura del proyecto.
- Trunk-based (una sola rama) descartado porque de `main` se producen los instaladores, y ese
  pipeline —build universal + el `.dmg` con el timeout de AppleScript resuelto en la Fase C— ya
  tiene suficientes aristas para no dispararlo desde una rama que puede estar a medias.
- git-flow completo descartado por desproporción: un desarrollador, sin releases coordinados.

**Números que sustentan las exclusiones:** el árbol versionado pesa 1,1 MB frente a 4,9 GB de
`app/src-tauri/target/` y 172 MB de `app/node_modules/` que quedan fuera — un factor de ~4 700
contra el `target/`. De ese 1,1 MB, 532 KB son los iconos de la aplicación: casi la mitad del
repositorio son binarios que no cambiarán, y el código más la documentación juntos pesan menos
que los iconos.

**Costo asumido, nombrado explícitamente:** el historial no refleja la cronología real del
desarrollo. Las cuatro fases ocurrieron antes del primer commit, así que los cinco commits
temáticos son una reconstrucción por temas y no un registro. `git log`, `git bisect` y
`git blame` no pueden responder cuándo se descubrió nada de lo que está en los ADRs 0001–0008.
Esa información sigue en este archivo y en `docs/decisiones/`, pero la asimetría es
irrecuperable: es el precio de haber empezado a versionar tarde.

**Pendiente para la siguiente sesión:**
- De aquí en adelante, cada sesión de trabajo cierra con sus propios commits — es la única forma
  de no volver a pagar el costo anterior.
- Confirmar en GitHub que `main` quedó como rama por defecto, y considerar protegerla (exigir PR
  desde `develop`), coherente con el ADR 0009.
- `develop` no está protegida: un `push --force` accidental ya puede perder trabajo, ahora que
  el remoto no está vacío.
- Sin cambios respecto a la sesión anterior: confirmación visual de MilkDrop, verificación con
  hardware real (30+ min), reconexión automática de entrada, puente de PCM para MilkDrop, y
  build/verificación en Windows (ver `docs/ROADMAP.md`).

---

## 2026-08-23 — Servidor Docker en LAN para pruebas multidispositivo (ADR 0011)

**Contexto:** Edward tiene un servidor privado en su red local (sin salida a internet) y quiere
servir ahí la versión web de desarrollo, para probarla desde cualquier dispositivo de la LAN sin
instalar Node/pnpm/Tauri en cada uno — mitigando de paso, por ahora, la fricción de Linux ya
documentada en `docs/ROADMAP.md` (WebKitGTK + ALSA vía capa de compatibilidad).

**Se hizo:**
- `app/docker/Dockerfile` (multi-stage: `node:22-alpine` para `pnpm build` → `caddy:2.9-alpine`
  para servir `dist/`), `app/docker/docker-compose.yml`, `app/docker/Caddyfile`,
  `app/.dockerignore`.
- Guía operativa `docs/guias/despliegue-docker-lan.md` (cómo levantar el contenedor, cómo probar
  desde otro dispositivo, cómo reconstruir tras cambios).

**Se decidió** (ADR 0011, nuevo):
- Caddy sobre nginx como servidor estático: el camino directo a HTTPS con CA local (`tls
  internal`) en una Etapa 2 futura evita tener que gestionar `mkcert`/`step-ca` a mano.
- Etapa 1 (implementada): HTTP plano en el puerto 8080, sin TLS. Como `getUserMedia` exige
  "contexto seguro" y el servidor no tiene salida a internet para pedir un certificado público,
  cada navegador cliente se lanza con `--unsafely-treat-insecure-origin-as-secure` como medida
  temporal y documentada, no como solución final.
- Sin hot-reload distribuido: build estático + `docker compose up --build` manual cuando haya
  cambios que probar en otro dispositivo. El día a día sigue siendo `pnpm dev` local.
- El motor Rust nativo (`cpal`) queda fuera de este alcance por completo — el contenedor nunca
  toca hardware de audio; el audio real lo captura el navegador cliente vía `WebAudioEngine`
  (`isTauri()` es falso fuera de la app de escritorio).

**Números:** build estático de 1.0 MB (`app/dist`); `node_modules` del stage builder (172 MB)
descartado íntegro de la imagen final (multi-stage); tamaño de imagen final y tiempo de build
quedan pendientes de medir en el servidor real.

**Costo asumido:** sin HMR entre dispositivos, sin TLS ni autenticación en esta etapa, puerto
expuesto a toda la LAN salvo restricción de firewall aparte, sin `engines` de Node fijado en
`package.json` (riesgo de deriva de versión entre la imagen y la máquina de desarrollo).

**Pendiente:**
- Verificación end-to-end real desde un segundo dispositivo de la LAN (build de la imagen,
  permiso de micrófono con la bandera insegura, reacción de las carátulas a audio real).
- Medir y registrar en el ADR 0011 el tamaño real de la imagen y el tiempo de build.
- Etapa 2 (HTTPS con `tls internal` + instalación de CA en clientes) queda trazada en el ADR pero
  sin implementar.
- Sin cambios respecto a la sesión anterior: confirmación visual de MilkDrop, verificación con
  hardware real (30+ min), reconexión automática de entrada, puente de PCM para MilkDrop, y
  build/verificación en Windows (ver `docs/ROADMAP.md`).
