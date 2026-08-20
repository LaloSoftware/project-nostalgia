# Cómo crear una carátula nueva

Esta guía se escribió después de construir las tres carátulas de la Fase A (Consola Digital,
Hi-Fi de Madera y MilkDrop) — ver `docs/decisiones/0003-orden-frontend-primero.md`, que exige
esperar a tener una abstracción ya ejercitada antes de documentarla. Las tres son deliberadamente
distintas en cómo dibujan (WebGL, CSS/DOM puro, y un motor de terceros) precisamente para probar
que el contrato aguanta variedad real.

## El contrato mínimo

Toda carátula vive en `app/src/skins/<id>/` y expone dos archivos:

```
skins/<id>/
├── manifest.ts   → export const manifest: SkinManifest
└── skin.ts       → export function createSkin(): Skin
```

`SkinManifest` (ver `app/src/core/types.ts`):

```ts
export const manifest: SkinManifest = {
  id: "mi-caratula",       // único, se usa para persistencia (ver core/settings.ts)
  name: "Mi Carátula",     // se muestra en el selector del shell
  author: "...",
  requiresPcm: false,      // ver la sección de más abajo antes de poner esto en true
};
```

`Skin` es una fábrica, no un singleton — `createSkin()` debe devolver una instancia nueva cada
vez, porque el host monta/desmonta carátulas en cada cambio (y, en Fase C, en cada ciclo de
destrucción/reconstrucción de la ventana — ver
`docs/decisiones/0005-bandeja-y-ventana-destruible.md`):

```ts
export function createSkin(): Skin {
  // estado privado de la instancia, closures — no módulo-nivel
  return {
    manifest,
    mount(root, host) { /* construir el DOM/canvas dentro de root */ },
    render(frame, state) { /* se llama en cada frame del bucle de rAF del host */ },
    unmount() { /* liberar TODO — ver checklist abajo */ },
  };
}
```

Y por último, registrarla en `app/src/main.ts`:

```ts
import { manifest } from "./skins/mi-caratula/manifest";
import { createSkin } from "./skins/mi-caratula/skin";
registerSkin({ manifest, createSkin });
```

## Qué puedes asumir, qué no

- **`render(frame, state)` se llama ~60 veces por segundo.** No asignes memoria nueva ahí si lo
  puedes evitar (reutiliza buffers, como hace `engine-web.ts` con sus `Float32Array`), y nunca
  hagas `shadowBlur` de canvas 2D por elemento dibujado — es la causa número uno de que un
  visualizador consuma 25% de CPU en vez de 3%. Si necesitas brillo/resplandor, hazlo como un
  post-proceso de un solo pase (ver el shader de `skins/console-digital/crt.frag`), no repitiendo
  el efecto por cada trazo.
- **No leas ni mutes `EngineState` por tu cuenta.** Todo lo que tu carátula quiera cambiar
  (volumen, mute, fuente, dispositivo) pasa por `SkinHostApi`, nunca por acceso directo al motor.
- **No asumas que tu carátula es la única.** No dejes listeners globales (`window.addEventListener`)
  sin quitarlos en `unmount()` — la siguiente carátula los heredaría.
- **No dependas de clases de utilidad compartidas.** Cada carátula trae su propio `skin.css`
  (importado desde `skin.ts` con `import "./skin.css"`) y es una identidad visual autocontenida —
  ver `docs/decisiones/0007-dependencias-y-cadena-de-suministro.md`, sección "qué se descartó".
- **Los iconos de trazo (lucide + morphicons) son del shell, no tuyos por defecto.** Puedes
  usarlos (la Consola Digital lo hace, para el botón de mute y el de fuente) o dibujar tus propios
  controles (el Hi-Fi de Madera lo hace, con interruptores de palanca en CSS puro). El contrato no
  impone widgets — ver `docs/arquitectura/contrato-de-datos.md`.

## Checklist de `unmount()`

Cada carátula existente es un ejemplo de qué hay que liberar según lo que use:

| Si tu carátula usa... | Debes liberar en `unmount()` |
|---|---|
| `ResizeObserver` | `observer.disconnect()` (las tres lo hacen) |
| WebGL | `gl.deleteTexture(...)`, `gl.deleteProgram(...)` (Consola Digital) |
| `window.addEventListener` para drag | `removeEventListener` de los mismos listeners (perilla y fader) |
| `morphicons` (`createMorph`) | `morph.destroy()` (Consola Digital) |
| Motor de terceros con su propio ciclo de vida | Soltar la referencia y dejar que `root.innerHTML = ""` se lleve el canvas (MilkDrop) |
| Cualquier caso | `root.innerHTML = ""` al final, para no dejar restos del DOM anterior |

## `requiresPcm`: solo si de verdad lo necesitas

La inmensa mayoría de carátulas se dibujan enteras a partir de `AudioFrame` (picos, RMS,
osciloscopio, espectro) — así lo hacen la Consola Digital y el Hi-Fi de Madera, y es lo que
deberías intentar primero. Márcalo `true` únicamente si tu carátula envuelve un motor de
visualización de terceros con su propio analizador interno, como MilkDrop sobre `butterchurn`,
que necesita un `AudioNode` real, no datos ya reducidos.

Si lo necesitas, usa `host.getWebAudioNode?.()` (ver el comentario extenso en
`SkinHostApi` en `core/types.ts`): puede devolver `null` si el motor activo no es Web Audio —
tu carátula debe degradar visiblemente en ese caso (mensaje claro), no fallar en silencio. Mira
`skins/milkdrop/skin.ts` como referencia completa, incluida la carga diferida vía `import()`
dinámico en `main.ts` — si tu carátula arrastra una dependencia pesada (la de MilkDrop añade
~900 KB por los presets de `butterchurn-presets`), regístrala igual, para que ese peso no entre
en el bundle principal.

## Ejemplo mínimo funcional

Una carátula "monocromo" que solo dibuja el pico como una barra, sin dependencias:

```ts
// manifest.ts
import type { SkinManifest } from "../../core/types";
export const manifest: SkinManifest = { id: "mono", name: "Monocromo", author: "tú" };
```

```ts
// skin.ts
import type { Skin } from "../../core/types";
import { manifest } from "./manifest";

export function createSkin(): Skin {
  let bar: HTMLElement;
  return {
    manifest,
    mount(root) {
      root.innerHTML = "";
      bar = document.createElement("div");
      bar.style.cssText = "background:#3ddc84;height:4px;width:0%;transition:width 50ms";
      root.appendChild(bar);
    },
    render(frame) {
      const peak = Math.max(frame.peakL, frame.peakR);
      bar.style.width = `${Math.round(peak * 100)}%`;
    },
    unmount() {
      bar?.remove();
    },
  };
}
```

Sin CSS externo, sin canvas, sin dependencias — y sigue siendo una carátula completa y válida
según el contrato.
