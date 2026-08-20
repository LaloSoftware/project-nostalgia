import type { AudioFrame, EngineState, Skin, SkinHostApi } from "../../core/types";
import { manifest } from "./manifest";
import { MIN_DB, MAX_DB, linearToDb } from "../../core/gain";
import "./skin.css";

// Hi-Fi de madera: agujas VU analógicas con balística real, fader deslizante, interruptores de
// palanca dibujados a mano. Ver docs/decisiones/0007-dependencias-y-cadena-de-suministro.md —
// esta carátula NO usa lucide/morphicons/motion a propósito: sus controles son su propio
// dibujo, no el cromo compartido del shell.

// Balística ANSI C16.5 clásica de un VU meter: ~300 ms para alcanzar el valor en un tono
// constante. Se implementa como una media móvil exponencial sobre el RMS, no sobre el pico —
// las agujas analógicas reales no pueden seguir transitorios rápidos, es justamente lo que las
// hace "analógicas" en vez de un medidor de pico digital.
const BALLISTICS_TAU_MS = 300;

// Escala típica de un VU: de -20 a +3 "VU" (aquí, dBFS de la señal RMS que llega).
const VU_MIN_DB = -20;
const VU_MAX_DB = 3;
const NEEDLE_MIN_DEG = -48;
const NEEDLE_MAX_DEG = 48;

function dbToNeedleDeg(db: number): number {
  const t = Math.min(1, Math.max(0, (db - VU_MIN_DB) / (VU_MAX_DB - VU_MIN_DB)));
  return NEEDLE_MIN_DEG + t * (NEEDLE_MAX_DEG - NEEDLE_MIN_DEG);
}

function dbToFaderT(db: number): number {
  return (db - MIN_DB) / (MAX_DB - MIN_DB);
}

export function createSkin(): Skin {
  let root: HTMLElement;
  let host: SkinHostApi;

  let needleL: HTMLElement;
  let needleR: HTMLElement;
  let faderTrack: HTMLElement;
  let faderThumb: HTMLElement;
  let muteSwitch: HTMLElement;
  let sourceSwitch: HTMLElement;

  let smoothedRmsL = 0;
  let smoothedRmsR = 0;
  let lastFrameTime = performance.now();
  let draggingFader = false;

  function buildDom(): void {
    root.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "wh-panel";

    const gauges = document.createElement("div");
    gauges.className = "wh-gauges";
    needleL = buildGauge("IZQ");
    needleR = buildGauge("DER");
    gauges.append(needleL.closest(".wh-gauge")!, needleR.closest(".wh-gauge")!);
    panel.appendChild(gauges);

    const controls = document.createElement("div");
    controls.className = "wh-controls";

    const faderWrap = document.createElement("div");
    faderWrap.className = "wh-fader-wrap";
    faderTrack = document.createElement("div");
    faderTrack.className = "wh-fader-track";
    faderThumb = document.createElement("div");
    faderThumb.className = "wh-fader-thumb";
    faderTrack.appendChild(faderThumb);
    const faderLabel = document.createElement("span");
    faderLabel.className = "wh-label";
    faderLabel.textContent = "VOLUMEN";
    faderWrap.append(faderTrack, faderLabel);
    controls.appendChild(faderWrap);

    const switches = document.createElement("div");
    switches.className = "wh-switches";
    muteSwitch = buildSwitch("SILENCIO", () => host.toggleMute());
    sourceSwitch = buildSwitch("TONO DE PRUEBA", () => {
      const current = sourceSwitch.classList.contains("on") ? "testTone" : "input";
      host.setSource(current === "input" ? "testTone" : "input");
    });
    switches.append(muteSwitch.closest(".wh-switch-wrap")!, sourceSwitch.closest(".wh-switch-wrap")!);
    controls.appendChild(switches);

    panel.appendChild(controls);
    root.appendChild(panel);

    faderThumb.addEventListener("pointerdown", onFaderPointerDown);
  }

  function buildGauge(label: string): HTMLElement {
    const gauge = document.createElement("div");
    gauge.className = "wh-gauge";
    const arc = document.createElement("div");
    arc.className = "wh-gauge-arc";
    const needle = document.createElement("div");
    needle.className = "wh-needle";
    const pivot = document.createElement("div");
    pivot.className = "wh-needle-pivot";
    const labelEl = document.createElement("span");
    labelEl.className = "wh-label wh-gauge-label";
    labelEl.textContent = label;
    gauge.append(arc, needle, pivot, labelEl);
    return needle;
  }

  function buildSwitch(label: string, onToggle: () => void): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "wh-switch-wrap";
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "wh-switch";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", "false");
    const lever = document.createElement("div");
    lever.className = "wh-switch-lever";
    sw.appendChild(lever);
    sw.addEventListener("click", onToggle);
    const labelEl = document.createElement("span");
    labelEl.className = "wh-label";
    labelEl.textContent = label;
    wrap.append(sw, labelEl);
    return sw;
  }

  function onFaderPointerDown(e: PointerEvent): void {
    draggingFader = true;
    faderThumb.setPointerCapture(e.pointerId);
    updateFaderFromPointer(e);
    window.addEventListener("pointermove", onFaderPointerMove);
    window.addEventListener("pointerup", onFaderPointerUp);
  }

  function onFaderPointerMove(e: PointerEvent): void {
    if (!draggingFader) return;
    updateFaderFromPointer(e);
  }

  function onFaderPointerUp(): void {
    draggingFader = false;
    window.removeEventListener("pointermove", onFaderPointerMove);
    window.removeEventListener("pointerup", onFaderPointerUp);
  }

  function updateFaderFromPointer(e: PointerEvent): void {
    const rect = faderTrack.getBoundingClientRect();
    // El fader va de abajo (silencio) hacia arriba (máximo), como un deslizador real de radio.
    const t = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    host.setGainDb(MIN_DB + t * (MAX_DB - MIN_DB));
  }

  function applyFaderPosition(state: EngineState): void {
    if (draggingFader) return;
    const t = dbToFaderT(state.gainDb);
    faderThumb.style.top = `${(1 - t) * 100}%`;
  }

  return {
    manifest,

    mount(r, h) {
      root = r;
      host = h;
      buildDom();
      lastFrameTime = performance.now();
    },

    render(frame: AudioFrame, state: EngineState) {
      const now = performance.now();
      const dt = Math.max(0, now - lastFrameTime);
      lastFrameTime = now;

      // Media móvil exponencial: alpha depende de dt para que la balística sea consistente
      // independientemente de la tasa de refresco real.
      const alpha = 1 - Math.exp(-dt / BALLISTICS_TAU_MS);
      smoothedRmsL += (frame.rmsL - smoothedRmsL) * alpha;
      smoothedRmsR += (frame.rmsR - smoothedRmsR) * alpha;

      needleL.style.rotate = `${dbToNeedleDeg(linearToDb(smoothedRmsL))}deg`;
      needleR.style.rotate = `${dbToNeedleDeg(linearToDb(smoothedRmsR))}deg`;

      applyFaderPosition(state);

      muteSwitch.classList.toggle("on", state.muted);
      muteSwitch.setAttribute("aria-checked", String(state.muted));

      const testToneOn = state.source === "testTone";
      sourceSwitch.classList.toggle("on", testToneOn);
      sourceSwitch.setAttribute("aria-checked", String(testToneOn));
    },

    unmount() {
      window.removeEventListener("pointermove", onFaderPointerMove);
      window.removeEventListener("pointerup", onFaderPointerUp);
      root.innerHTML = "";
    },
  };
}
