import type { AudioFrame, EngineState, Skin, SkinHostApi } from "../../core/types";
import { manifest } from "./manifest";
import { SPECTRUM_PALETTE } from "./palette";
import { MIN_DB, MAX_DB } from "../../core/gain";
import crtFragSrc from "./crt.frag?raw";
import { createMorph, type Morph } from "morphicons/dom";
import { Volume2, VolumeX, Disc3, AudioLines } from "lucide";
import { animate } from "motion/mini";
import "./skin.css";

// La Consola Digital: osciloscopio + espectro + medidores dibujados en un canvas 2D oculto
// ("la pantalla"), con un post-proceso WebGL2 de un solo pase (crt.frag) que le da el brillo de
// fósforo, las líneas de barrido y la aberración cromática — ver
// docs/decisiones/0007-dependencias-y-cadena-de-suministro.md, sección "Efectos".
//
// Los controles (perilla, botones, LED de clip, lecturas DSEG) son DOM real alrededor de la
// pantalla, no parte de la textura sombreada — igual que en un equipo real, donde la vidriera
// con el brillo cubre solo el display y los controles físicos quedan fuera de ella.

const VERTEX_SRC = `#version 300 es
  const vec2 POS[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
  out vec2 vUv;
  void main() {
    vUv = (POS[gl_VertexID] + 1.0) * 0.5;
    gl_Position = vec4(POS[gl_VertexID], 0.0, 1.0);
  }
`;

const KNOB_MIN_DEG = -135;
const KNOB_MAX_DEG = 135;
const PEAK_HOLD_DECAY = 0.965; // por frame a 60fps: sostiene el pico y cae suavemente

function paletteAt(t: number): string {
  const idx = Math.round(Math.min(1, Math.max(0, t)) * (SPECTRUM_PALETTE.length - 1));
  return SPECTRUM_PALETTE[idx];
}

function dbToKnobDeg(db: number): number {
  const t = (db - MIN_DB) / (MAX_DB - MIN_DB);
  return KNOB_MIN_DEG + t * (KNOB_MAX_DEG - KNOB_MIN_DEG);
}

function formatGain(state: EngineState): string {
  if (state.muted) return "-∞ dB";
  return `${state.gainDb >= 0 ? "+" : ""}${state.gainDb.toFixed(1)} dB`;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Error compilando shader: ${log}`);
  }
  return shader;
}

export function createSkin(): Skin {
  let root: HTMLElement;
  let host: SkinHostApi;

  let sourceCanvas: HTMLCanvasElement;
  let ctx2d: CanvasRenderingContext2D;
  let glCanvas: HTMLCanvasElement;
  let gl: WebGL2RenderingContext;
  let program: WebGLProgram;
  let texture: WebGLTexture;
  let uSourceLoc: WebGLUniformLocation | null;
  let uResolutionLoc: WebGLUniformLocation | null;
  let uTimeLoc: WebGLUniformLocation | null;
  let resizeObserver: ResizeObserver;

  let knobEl: HTMLElement;
  let mutePathEl: SVGPathElement;
  let sourcePathEl: SVGPathElement;
  let muteMorph: Morph;
  let sourceMorph: Morph;
  let clipLed: HTMLElement;
  let gainReadout: HTMLElement;
  let sampleRateReadout: HTMLElement;
  let latencyReadout: HTMLElement;

  let dragging = false;
  let dragStartY = 0;
  let dragStartDb = 0;
  let lastDisplayedDb = NaN;
  let lastMuted = false;
  let lastSource: EngineState["source"] = "input";
  let clipHoldUntil = 0;
  let holdL = 0;
  let holdR = 0;
  const startTime = performance.now();

  function buildDom(): void {
    root.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "cd-panel";

    const screenWrap = document.createElement("div");
    screenWrap.className = "cd-screen-wrap";
    glCanvas = document.createElement("canvas");
    glCanvas.className = "cd-webgl";
    screenWrap.appendChild(glCanvas);
    panel.appendChild(screenWrap);

    const controls = document.createElement("div");
    controls.className = "cd-controls";

    const readouts = document.createElement("div");
    readouts.className = "cd-readouts";
    gainReadout = makeReadout("MASTER");
    sampleRateReadout = makeReadout("SAMPLE RATE");
    latencyReadout = makeReadout("LATENCY");
    readouts.append(
      gainReadout.parentElement!,
      sampleRateReadout.parentElement!,
      latencyReadout.parentElement!,
    );
    controls.appendChild(readouts);

    clipLed = document.createElement("div");
    clipLed.className = "cd-led";
    clipLed.title = "Clip";
    const clipWrap = document.createElement("div");
    clipWrap.className = "cd-led-wrap";
    clipWrap.append(clipLed, labelSpan("CLIP"));
    controls.appendChild(clipWrap);

    const knobWrap = document.createElement("div");
    knobWrap.className = "cd-knob-wrap";
    knobEl = document.createElement("div");
    knobEl.className = "cd-knob";
    knobEl.setAttribute("role", "slider");
    knobEl.setAttribute("aria-label", "Volumen master");
    knobEl.tabIndex = 0;
    const knobMark = document.createElement("div");
    knobMark.className = "cd-knob-mark";
    knobEl.appendChild(knobMark);
    knobWrap.append(knobEl, labelSpan("MASTER"));
    controls.appendChild(knobWrap);

    const muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.className = "cd-btn";
    muteBtn.setAttribute("aria-label", "Silenciar");
    mutePathEl = makeIconSvg(muteBtn);
    controls.appendChild(muteBtn);

    const sourceBtn = document.createElement("button");
    sourceBtn.type = "button";
    sourceBtn.className = "cd-btn";
    sourceBtn.setAttribute("aria-label", "Cambiar fuente");
    sourcePathEl = makeIconSvg(sourceBtn);
    controls.appendChild(sourceBtn);

    panel.appendChild(controls);
    root.appendChild(panel);

    muteMorph = createMorph(mutePathEl, Volume2);
    sourceMorph = createMorph(sourcePathEl, Disc3);

    muteBtn.addEventListener("click", () => host.toggleMute());
    sourceBtn.addEventListener("click", () =>
      host.setSource(lastSource === "input" ? "testTone" : "input"),
    );

    knobEl.addEventListener("pointerdown", onKnobPointerDown);
    knobEl.addEventListener("keydown", onKnobKeyDown);
  }

  function makeReadout(label: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cd-readout";
    const value = document.createElement("span");
    value.className = "cd-readout-value cd-dseg";
    value.textContent = "--";
    wrap.append(labelSpan(label), value);
    return value;
  }

  function labelSpan(text: string): HTMLElement {
    const span = document.createElement("span");
    span.className = "cd-label";
    span.textContent = text;
    return span;
  }

  function makeIconSvg(button: HTMLButtonElement): SVGPathElement {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "cd-icon");
    const path = document.createElementNS(svgNs, "path") as SVGPathElement;
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    button.appendChild(svg);
    return path;
  }

  function onKnobPointerDown(e: PointerEvent): void {
    dragging = true;
    dragStartY = e.clientY;
    dragStartDb = lastDisplayedDb;
    knobEl.setPointerCapture(e.pointerId);
    window.addEventListener("pointermove", onKnobPointerMove);
    window.addEventListener("pointerup", onKnobPointerUp);
  }

  function onKnobPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const deltaPx = dragStartY - e.clientY; // arrastrar hacia arriba sube el volumen
    const SENSITIVITY = 0.4; // dB por pixel
    const db = Math.min(MAX_DB, Math.max(MIN_DB, dragStartDb + deltaPx * SENSITIVITY));
    host.setGainDb(db);
    // Respuesta inmediata 1:1 durante el arrastre; sin resorte — el resorte es solo para
    // cambios programáticos (ver render()).
    knobEl.style.rotate = `${dbToKnobDeg(db)}deg`;
    lastDisplayedDb = db;
  }

  function onKnobPointerUp(): void {
    dragging = false;
    window.removeEventListener("pointermove", onKnobPointerMove);
    window.removeEventListener("pointerup", onKnobPointerUp);
  }

  function onKnobKeyDown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 3 : 1;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      host.setGainDb(lastDisplayedDb + step);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      host.setGainDb(lastDisplayedDb - step);
      e.preventDefault();
    }
  }

  function initGl(): void {
    sourceCanvas = document.createElement("canvas");
    ctx2d = sourceCanvas.getContext("2d")!;

    const context = glCanvas.getContext("webgl2");
    if (!context) throw new Error("WebGL2 no disponible");
    gl = context;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, crtFragSrc);
    program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Error enlazando programa: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    uSourceLoc = gl.getUniformLocation(program, "uSource");
    uResolutionLoc = gl.getUniformLocation(program, "uResolution");
    uTimeLoc = gl.getUniformLocation(program, "uTime");

    texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    resizeObserver = new ResizeObserver(() => resizeCanvases());
    resizeObserver.observe(glCanvas);
    resizeCanvases();
  }

  function resizeCanvases(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = glCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w;
      glCanvas.height = h;
      sourceCanvas.width = w;
      sourceCanvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  function drawScreen(frame: AudioFrame): void {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;

    ctx2d.fillStyle = "#020403";
    ctx2d.fillRect(0, 0, w, h);

    // --- Espectro (mitad inferior) ---
    const specTop = h * 0.55;
    const specH = h * 0.4;
    const bins = frame.spectrum.length;
    const barGap = w * 0.004;
    const barW = w / bins - barGap;
    for (let i = 0; i < bins; i++) {
      const mag = frame.spectrum[i];
      const barH = Math.max(1, mag * specH);
      ctx2d.fillStyle = paletteAt(mag);
      ctx2d.fillRect(i * (barW + barGap), specTop + specH - barH, barW, barH);
    }

    // --- Osciloscopio (mitad superior) ---
    const scopeTop = h * 0.06;
    const scopeH = h * 0.42;
    const midY = scopeTop + scopeH / 2;
    drawTrace(frame.scope, midY, scopeH, paletteAt(0.55));
    drawTrace(frame.scopeR, midY, scopeH, paletteAt(0.3));

    function drawTrace(data: Float32Array, mid: number, amp: number, color: string): void {
      ctx2d.beginPath();
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = Math.max(1, h * 0.004);
      const step = w / (data.length - 1);
      for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const y = mid - data[i] * (amp / 2);
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      ctx2d.stroke();
    }

    // --- Medidores de pico/RMS (columnas laterales, estilo LED segmentado) ---
    holdL = Math.max(frame.peakL, holdL * PEAK_HOLD_DECAY);
    holdR = Math.max(frame.peakR, holdR * PEAK_HOLD_DECAY);
    drawMeter(0, frame.rmsL, holdL);
    drawMeter(w - w * 0.03, frame.rmsR, holdR);

    function drawMeter(x: number, rms: number, hold: number): void {
      const meterW = w * 0.03;
      const segments = 24;
      const segGap = h * 0.003;
      const segH = h / segments - segGap;
      const litCount = Math.round(rms * segments);
      const holdSeg = Math.min(segments - 1, Math.round(hold * segments));
      for (let s = 0; s < segments; s++) {
        const t = s / (segments - 1);
        const y = h - (s + 1) * (segH + segGap);
        if (s < litCount) {
          ctx2d.fillStyle = paletteAt(t);
          ctx2d.fillRect(x, y, meterW, segH);
        } else if (s === holdSeg) {
          ctx2d.fillStyle = paletteAt(t);
          ctx2d.globalAlpha = 0.85;
          ctx2d.fillRect(x, y, meterW, segH);
          ctx2d.globalAlpha = 1;
        }
      }
    }
  }

  function drawGl(): void {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uSourceLoc, 0);
    gl.uniform2f(uResolutionLoc, glCanvas.width, glCanvas.height);
    gl.uniform1f(uTimeLoc, (performance.now() - startTime) / 1000);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  return {
    manifest,

    mount(r, h) {
      root = r;
      host = h;
      buildDom();
      initGl();
    },

    render(frame, state) {
      drawScreen(frame);
      drawGl();

      // Perilla: arrastre = respuesta directa (ver onKnobPointerMove); cambio programático
      // (carga de ajustes, etc.) = resorte, para que se sienta como un giro físico y no un salto.
      if (!dragging && state.gainDb !== lastDisplayedDb) {
        if (Number.isNaN(lastDisplayedDb)) {
          knobEl.style.rotate = `${dbToKnobDeg(state.gainDb)}deg`;
        } else {
          animate(
            knobEl,
            { rotate: `${dbToKnobDeg(state.gainDb)}deg` },
            { type: "spring", stiffness: 260, damping: 24 },
          );
        }
        lastDisplayedDb = state.gainDb;
      }
      knobEl.setAttribute("aria-valuenow", state.gainDb.toFixed(1));
      knobEl.setAttribute("aria-valuemin", String(MIN_DB));
      knobEl.setAttribute("aria-valuemax", String(MAX_DB));

      if (state.muted !== lastMuted) {
        muteMorph.morphTo(state.muted ? VolumeX : Volume2, "snappy");
        lastMuted = state.muted;
      }
      if (state.source !== lastSource) {
        sourceMorph.morphTo(state.source === "input" ? Disc3 : AudioLines, "snappy");
        lastSource = state.source;
      }

      if (frame.clip) clipHoldUntil = performance.now() + 500;
      clipLed.classList.toggle("lit", performance.now() < clipHoldUntil);

      gainReadout.textContent = formatGain(state);
      sampleRateReadout.textContent = `${(state.sampleRateOut / 1000).toFixed(1)} kHz`;
      latencyReadout.textContent = `${state.latencyMs.toFixed(1)} ms`;
    },

    unmount() {
      resizeObserver?.disconnect();
      muteMorph?.destroy();
      sourceMorph?.destroy();
      window.removeEventListener("pointermove", onKnobPointerMove);
      window.removeEventListener("pointerup", onKnobPointerUp);
      gl?.deleteTexture(texture);
      gl?.deleteProgram(program);
      // Los navegadores limitan cuántos contextos WebGL pueden estar vivos a la vez (típicamente
      // 8-16). Sin esto, alternar de carátula repetidamente podía ir acumulando contextos
      // "zombis" hasta agotar el límite — y un getContext('webgl2') fallido en OTRA carátula
      // (p. ej. MilkDrop) se manifiesta como pantalla negra sin ningún error visible.
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      root.innerHTML = "";
    },
  };
}
