# ADR 0005 — Bandeja del sistema con ventana destruible

**Estado:** aceptada — 2026-08-14

## Contexto

El ADR 0001 elige Tauri sobre Electron específicamente por el escenario de "ventana minimizada
mientras se trabaja en otra cosa": ~15–25 MB y CPU <1% frente a ~140–180 MB de Electron. Esa
ventaja **no se materializa automáticamente** solo por usar Tauri — depende de cómo se maneje el
ciclo de vida de la ventana. Una app Tauri que simplemente oculta la ventana con `hide()` sigue
manteniendo el webview vivo en memoria, perdiendo la mayor parte de la ventaja.

## Alternativas consideradas

- **Ventana normal, siempre visible (comportamiento de app convencional):** más simple de
  implementar, pero paga el costo del webview todo el tiempo (~85–135 MB) incluso cuando el
  usuario solo quiere música de fondo. Descartada porque anula el argumento central del ADR 0001.
- **Ocultar la ventana (`hide()`) sin destruirla:** intermedio, pero el webview de WebKit/WebView2
  sigue residente en memoria. No alcanza el ~20 MB objetivo.
- **Modo mini / siempre encima (widget flotante):** atractivo para la estética de reproductor
  antiguo, pero es trabajo de diseño adicional en cada carátula. Queda en el roadmap, no en la v1.
- **Bandeja + ventana destruible — elegida.**

## Decisión

Al cerrar o minimizar, la ventana (webview) se **destruye por completo**; solo permanece el
proceso Rust con los streams de `cpal` activos. Al hacer clic en el ícono de la bandeja, se
reconstruye la ventana con `WebviewWindowBuilder`.

Implementación: interceptar `RunEvent::ExitRequested` con `api.prevent_exit()` para que cerrar la
ventana no mate el proceso; `TrayIconBuilder` con menú Mostrar / Silenciar / Salir. En macOS,
`ActivationPolicy::Accessory` para no ocupar el Dock mientras solo vive en la bandeja.

## Costo aceptado

- Reconstruir la ventana tiene un costo de arranque perceptible (recrear el webview, remontar la
  carátula activa) cada vez que se vuelve a mostrar. Se acepta porque ocurre con poca frecuencia
  frente al tiempo que la app pasa reproduciendo en segundo plano.
- El estado de la UI (carátula activa, posición de scroll de ajustes, etc.) debe persistirse
  explícitamente antes de destruir la ventana y restaurarse al reconstruirla, en vez de vivir
  implícitamente en memoria del webview.

## Por qué esta es la característica que justifica el stack

Sin este comportamiento, la diferencia práctica entre Tauri y Electron para el caso de uso real
(música de fondo mientras se trabaja) se reduce a ~80 MB de RAM — perceptible pero no decisivo.
Con él, la diferencia es la fila completa de "minimizada" del ADR 0001: ~150 MB vs ~20 MB. Esta
decisión no es un detalle de pulido: es la que hace que la decisión de stack del ADR 0001 valga
la pena.
