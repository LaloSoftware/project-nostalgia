# Permisos de plataforma

## macOS: micrófono/entrada de línea

CoreAudio exige permiso explícito para abrir un stream de entrada desde macOS 10.14. Dos archivos
lo declaran, ambos en `app/src-tauri/`:

- **`Info.plist`** — `NSMicrophoneUsageDescription`, el texto que macOS muestra en el diálogo de
  permiso la primera vez que la app intenta abrir un stream de entrada. Referenciado desde
  `tauri.conf.json` → `bundle.macOS.infoPlist`.
- **`entitlements.plist`** — `com.apple.security.device.audio-input`, necesario para que una
  build firmada con hardened runtime (no ad-hoc) mantenga el acceso; sin esto, una build
  notarizada puede negar el micrófono aunque el usuario lo haya autorizado en el diálogo del
  sistema. Referenciado desde `tauri.conf.json` → `bundle.macOS.entitlements`.

**Riesgo conocido, no verificado en este entorno de desarrollo:** el diálogo de permiso se
dispara la primera vez que `cpal` abre de verdad un stream de entrada (dentro de
`Engine::start()`), no antes. Si en la práctica no aparece de forma fiable (algunos wrappers de
CoreAudio tienen este problema), la app fallará con un error de dispositivo poco claro en vez de
pedir permiso. La mitigación, si hace falta, es forzar el diálogo explícitamente antes de abrir
el stream (equivalente a `AVCaptureDevice.requestAccess` en un proyecto Swift/Obj-C nativo) — no
implementado porque no se pudo confirmar si el fallback es necesario sin una Mac con el diálogo
de permisos aún no concedido para probar.

**Manejo del rechazo — implementado.** `describe_cpal_error()` en `audio/mod.rs` traduce
`cpal::ErrorKind` a mensajes en español accionables antes de que crucen a `commands.rs`/el
frontend, el mismo espíritu que `main.ts`/`describeError()` ya aplicaba en la Fase A para
`getUserMedia`. Cubre explícitamente `PermissionDenied` (con los pasos concretos de macOS y
Windows en el propio mensaje), `DeviceNotAvailable`, `HostUnavailable`, `DeviceBusy` y
`UnsupportedConfig`; el resto de variantes (`ErrorKind` es `#[non_exhaustive]`, cpal puede sumar
más en el futuro) cae al mensaje propio de cpal en vez de fallar en silencio. Se usa en los seis
puntos donde `Engine::start()`/`rebuild_output_session()` pueden fallar por un error de `cpal`:
`default_input_config()`, `default_output_config()`, `build_input_stream()`,
`build_output_stream()` y ambos `.play()`.

## Windows: privacidad del micrófono

La app debe estar permitida en **Configuración → Privacidad y seguridad → Micrófono**. A
diferencia de macOS, Windows no siempre dispara un diálogo de permiso en el primer uso para
aplicaciones de escritorio Win32 (el comportamiento varía según la versión de Windows y si la app
está empaquetada como MSIX) — es responsabilidad del usuario revisar esa configuración si
`Engine::start()` falla sin una razón obvia. No verificado en este entorno de desarrollo (sin
una máquina Windows disponible) — queda pendiente para cuando el usuario lo pruebe en su PC.

## Herramientas de compilación en macOS

`cargo build`/`cargo tauri build` en macOS necesitan las **Xcode Command Line Tools** (no la
Xcode.app completa) para compilar y enlazar contra CoreAudio/AudioToolbox. Se verificó en este
entorno: con solo las Command Line Tools instaladas (`xcode-select --install`) y sin Xcode.app,
`cargo build` compiló y enlazó el binario completo sin problema (ver `docs/BITACORA.md`). Xcode
completo solo haría falta para firma avanzada/notarización o distribución en el Mac App Store —
fuera del alcance de esta v1 (ver `docs/guias/build-y-empaquetado.md`).

## Verificación pendiente

Ninguno de los dos flujos de permiso (macOS, Windows) se pudo ejercitar de punta a punta en el
entorno donde se escribió este motor: no había un diálogo de permisos "limpio" que provocar (el
entorno de desarrollo probablemente ya tenía el micrófono autorizado para herramientas de
terminal) ni una máquina Windows disponible. Queda en la tabla de verificación del proyecto como
algo que el usuario debe confirmar en su propio hardware.
