import type { Skin, SkinHostApi } from "../../core/types";
import { manifest } from "./manifest";
import * as butterchurnImport from "butterchurn";
import type { ButterchurnVisualizer } from "butterchurn";
import butterchurnPresets from "butterchurn-presets";
import "./skin.css";

// El bundle de `butterchurn` está doblemente envuelto: es un módulo transpilado a ES por dentro
// (webpack `__webpack_require__.r` + `.d(..., "default", ...)` → `{ __esModule: true, default:
// Butterchurn }`), y ESE resultado es a su vez el "default export" del wrapper UMD que Vite
// empaqueta (`export default require_butterchurn();`, confirmado leyendo
// node_modules/.vite/deps/butterchurn.js directamente). Con `import * as ns`, `ns.default` da el
// objeto intermedio (sin createVisualizer todavía) — hace falta bajar un nivel más,
// `ns.default.default`, para llegar a la clase real. Un primer intento que solo desenvolvía un
// nivel seguía fallando con el mismo error en runtime; esta versión no asume una profundidad
// fija y baja capas de `.default` hasta encontrar el objeto que de verdad tiene
// `createVisualizer`, para no volver a romperse si el empaquetado cambia de nuevo entre dev y
// build de producción. `butterchurn-presets` no tiene este problema — exporta la clase directo,
// verificado aparte contra el paquete instalado; no se toca.
function resolveButterchurnExport(mod: unknown): typeof import("butterchurn").default {
  let candidate = mod;
  while (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as { createVisualizer?: unknown }).createVisualizer !== "function" &&
    "default" in candidate
  ) {
    candidate = (candidate as { default: unknown }).default;
  }
  return candidate as typeof import("butterchurn").default;
}

const butterchurn = resolveButterchurnExport(butterchurnImport);

// MilkDrop: el visualizador de Winamp portado a WebGL, sobre el tocadiscos real. Es el prototipo
// de Fase A discutido en docs/decisiones/0004-alcance-v1.md — su paso al build nativo (Fase B)
// depende del puente de PCM evaluado en docs/arquitectura/motor-de-audio.md, no está garantizado.
//
// A diferencia de las otras dos carátulas, esta NO dibuja a partir de AudioFrame: butterchurn
// trae su propio analizador y necesita un AudioNode real — de ahí requiresPcm: true en el
// manifiesto y el uso de host.getWebAudioNode() (ver core/types.ts).

// Subconjunto curado, no los ~100 presets disponibles — nombres verificados contra el paquete
// instalado. El primero es el mismo que usa el ejemplo oficial de butterchurn.
const CURATED_PRESETS = [
  "Flexi, martin + geiss - dedicated to the sherwin maxawow",
  "martin - stormy sea (2010 update)",
  "Rovastar - Oozing Resistance",
  "Unchained - Rewop",
  "Zylot - Star Ornament",
  "martin - mandelbox explorer - high speed demo version",
  "Unchained & Rovastar - Wormhole Pillars (Hall of Shadows mix)",
  "martin - witchcraft reloaded",
];

export function createSkin(): Skin {
  let root: HTMLElement;
  let host: SkinHostApi;
  let canvas: HTMLCanvasElement;
  let visualizer: ButterchurnVisualizer | null = null;
  let resizeObserver: ResizeObserver;
  let presetIndex = 0;
  let unavailableNotice: HTMLElement | null = null;

  function resize(): void {
    if (!visualizer) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = w;
    canvas.height = h;
    visualizer.setRendererSize(w, h);
  }

  function loadPreset(index: number, blendSeconds: number): void {
    if (!visualizer) return;
    const presets = butterchurnPresets.getPresets();
    const name = CURATED_PRESETS[index];
    const preset = presets[name];
    if (preset) visualizer.loadPreset(preset, blendSeconds);
  }

  function buildDom(): void {
    root.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "md-panel";

    canvas = document.createElement("canvas");
    canvas.className = "md-canvas";
    panel.appendChild(canvas);

    const bar = document.createElement("div");
    bar.className = "md-bar";
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "md-btn";
    nextBtn.textContent = "▶ SIGUIENTE PRESET";
    nextBtn.addEventListener("click", () => {
      presetIndex = (presetIndex + 1) % CURATED_PRESETS.length;
      loadPreset(presetIndex, 2.5);
      nameLabel.textContent = CURATED_PRESETS[presetIndex];
    });
    const nameLabel = document.createElement("span");
    nameLabel.className = "md-preset-name";
    nameLabel.textContent = CURATED_PRESETS[presetIndex];
    bar.append(nextBtn, nameLabel);
    panel.appendChild(bar);

    root.appendChild(panel);
  }

  return {
    manifest,

    mount(r, h) {
      root = r;
      host = h;
      buildDom();

      const node = host.getWebAudioNode?.() ?? null;
      if (!node) {
        // Fase B (o cualquier motor sin grafo de Web Audio) todavía no implementa
        // getWebAudioNode() — ver el comentario en core/types.ts. Degradar visiblemente en vez
        // de fallar en silencio.
        unavailableNotice = document.createElement("div");
        unavailableNotice.className = "md-unavailable";
        unavailableNotice.textContent =
          "MilkDrop necesita el motor Web Audio de la Fase A — no disponible en este motor.";
        root.appendChild(unavailableNotice);
        return;
      }

      try {
        const audioContext = node.context as AudioContext;
        visualizer = butterchurn.createVisualizer(audioContext, canvas, {
          width: canvas.clientWidth || 800,
          height: canvas.clientHeight || 450,
        });
        visualizer.connectAudio(node);
        loadPreset(presetIndex, 0);

        resizeObserver = new ResizeObserver(() => resize());
        resizeObserver.observe(canvas);
        resize();
      } catch (err) {
        // Antes esto fallaba en silencio: visualizer se quedaba en null y render()/loadPreset()
        // hacían no-op vía optional chaining, dejando pantalla negra sin ninguna pista de qué
        // pasó. Butterchurn pide un contexto WebGL2 (canvas.getContext('webgl2', ...)) — si eso
        // devuelve null (soporte de WebGL2, límite de contextos activos del navegador, etc.),
        // todo lo que sigue lanza. Ahora se ve el motivo real en vez de adivinar.
        console.error("MilkDrop: no se pudo inicializar butterchurn:", err);
        visualizer = null;
        const notice = document.createElement("div");
        notice.className = "md-unavailable";
        notice.textContent = `No se pudo iniciar el visualizador: ${err instanceof Error ? err.message : String(err)}`;
        root.appendChild(notice);
      }
    },

    render() {
      // Butterchurn lee el audio directamente del AudioNode conectado en mount(); no consume
      // AudioFrame/EngineState — por eso ambos parámetros no se usan aquí.
      visualizer?.render();
    },

    unmount() {
      resizeObserver?.disconnect();
      visualizer = null;
      unavailableNotice = null;
      root.innerHTML = "";
    },
  };
}
