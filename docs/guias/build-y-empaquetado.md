# Build y empaquetado

## Desarrollo

```sh
cd app
pnpm install
pnpm tauri dev
```

Esto levanta el servidor de Vite (`beforeDevCommand`, `pnpm dev`) y compila/lanza el motor Rust
apuntando a `http://localhost:5173` — hot reload del frontend, recompilación de Rust al cambiar
código nativo.

## Build de producción (macOS)

```sh
cd app
pnpm tauri build            # nativo: arm64 en Apple Silicon, x64 en Intel
pnpm tauri build --target universal-apple-darwin   # universal — ver nota abajo
```

**Verificado en este entorno** (Apple Silicon, sin sesión de escritorio interactiva — ver más
abajo): `pnpm tauri build` compila el motor en modo release (~1 min con caché frío) y genera un
`.app` válido y correctamente firmado ad-hoc en
`src-tauri/target/release/bundle/macos/Nostalgia.app`, con `NSMicrophoneUsageDescription`
fusionado desde `Info.plist` — confirmado con `plutil -p`.

### El paso del `.dmg` necesita una sesión de Finder real — con solución verificada

En un entorno sin sesión de escritorio interactiva (una terminal automatizada, CI/headless) el
paso final de empaquetado falla así:

```
osascript ...: execution error: Finder detectó un error:
Tiempo límite agotado para un evento Apple. (-1712)
failed to bundle project: error running bundle_dmg.sh
```

Es `create-dmg` (el script que usa `tauri-bundler` por dentro) ejecutando AppleScript para
decorarle la ventana al `.dmg` (posición del icono, fondo) — necesita hablarle a Finder por Apple
Events, y Finder no responde a tiempo sin una sesión de usuario interactiva de verdad detrás.
**El `.app` en sí se construye bien** en ambos casos; es solo este paso cosmético el que falla.

Si te pasa en tu Mac con una sesión normal (Terminal.app abierta en tu escritorio), revisa que
Terminal tenga permiso de Automatización sobre Finder en Ajustes → Privacidad y Seguridad — ese
es probablemente el problema real ahí, y solucionarlo ahí te da el `.dmg` completo con estilo.

**Si vuelve a fallar igual, hay una salida verificada:** `create-dmg` (la herramienta detrás del
script) trae un flag pensado exactamente para este caso — CI/Jenkins headless —
[`--skip-jenkins`](https://github.com/create-dmg/create-dmg/issues/72), que se salta el paso de
AppleScript a cambio de un `.dmg` sin fondo/posición de iconos personalizados (mismo contenido,
solo sin estilo). `tauri build` no expone ese flag, pero se puede invocar el script generado
directamente con él, reusando el `.app` que sí se construyó:

```sh
# Sustituye <target> por "release" o "universal-apple-darwin/release" según el build
APP_DIR="src-tauri/target/<target>/bundle/macos"
DMG_DIR="src-tauri/target/<target>/bundle/dmg"

cd "$APP_DIR" && bash "$DMG_DIR/bundle_dmg.sh" \
  --volname Nostalgia \
  --icon Nostalgia.app 180 170 \
  --app-drop-link 480 170 \
  --window-size 660 400 \
  --hide-extension Nostalgia.app \
  --volicon "$DMG_DIR/icon.icns" \
  --skip-jenkins \
  "$DMG_DIR/Nostalgia_0.1.0_universal.dmg" \
  Nostalgia.app
```

Verificado en este entorno: produce un `.dmg` real de ~7.5 MB que monta correctamente, contiene
`Nostalgia.app` (binario universal, `lipo -info` confirma `x86_64 arm64`) y el symlink de
`Applications` para instalar arrastrando — funcionalmente completo, solo sin el fondo/posición
de iconos personalizados que la sesión de Finder habría aplicado.

### Build universal (Intel + Apple Silicon)

Necesita el target de Rust para la otra arquitectura instalado:

```sh
rustup target add x86_64-apple-darwin
pnpm tauri build --target universal-apple-darwin
```

**Verificado end-to-end en este entorno**, incluido el workaround de `--skip-jenkins` de arriba
para el `.dmg`: el `.app` resultante es un binario universal real (`lipo -info` confirma
`x86_64 arm64` en el mismo ejecutable), y el `.dmg` generado con el workaround monta y contiene
ese `.app` correctamente.

### Firma y distribución

Sin una identidad de firma de Apple Developer configurada, el `.app`/`.dmg` quedan sin firmar (o
firmados ad-hoc). Para abrir un build sin firmar la primera vez: clic derecho sobre `Nostalgia.app`
→ Abrir, en vez de doble clic (que Gatekeeper bloquearía). Firma y notarización reales quedan
fuera del alcance de esta v1 — necesitan una cuenta de Apple Developer, que no forma parte de este
proyecto.

## Build de producción (Windows)

No verificado en este entorno (sin una máquina Windows disponible). `pnpm tauri build` en Windows
debería generar un instalador NSIS/MSI vía el mismo comando; el primer lanzamiento probablemente
dispare una advertencia de SmartScreen (binario sin firmar) — clic en "Más información" → "Ejecutar
de todas formas".

## Identificador de la aplicación

`tauri.conf.json` usa `"identifier": "com.nostalgia.desktop"` — **no** `com.nostalgia.app`: Tauri
advierte explícitamente que un identifier terminado en `.app` choca con la extensión del bundle
de macOS. Detectado y corregido durante esta misma sesión de build — ver `docs/BITACORA.md`.
