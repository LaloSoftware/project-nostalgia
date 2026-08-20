import { invoke } from "@tauri-apps/api/core";
import type { AudioDeviceInfo, AudioEngine } from "./engine";
import type { AudioFrame, AudioSource, EngineState } from "./types";
import { clampDb } from "./gain";

// Motor de la Fase B: implementa el mismo contrato AudioEngine que engine-web.ts, pero cada
// operación es una invocación IPC hacia el motor Rust (ver src-tauri/src/commands.rs) en vez de
// tocar Web Audio directamente. Los nombres de comando y de argumentos usan camelCase — Tauri
// convierte los parámetros snake_case de Rust a camelCase por defecto en el lado JS.
//
// Los tipos de Rust (AudioFrame, EngineState en src-tauri/src/audio/mod.rs y analysis.rs) usan
// #[serde(rename_all = "camelCase")] con los MISMOS nombres de campo que core/types.ts a
// propósito — ver ese comentario en el código Rust. Por eso aquí no hay mapeo de campos, solo
// conversión de tipo donde JSON y TypeScript difieren (arrays -> Float32Array).

// Forma cruda tal como llega por IPC: los buffers viajan como number[] (JSON no tiene
// Float32Array), y channelPair como tupla o null.
interface RawAudioFrame {
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
  scope: number[];
  scopeR: number[];
  spectrum: number[];
  clip: boolean;
}

interface RawEngineState {
  running: boolean;
  device: string | null;
  channelPair: [number, number] | null;
  gainDb: number;
  muted: boolean;
  sampleRateIn: number;
  sampleRateOut: number;
  latencyMs: number;
  source: AudioSource;
}

interface RawAudioDeviceInfo {
  id: string;
  label: string;
  channelCount: number;
}

function toAudioFrame(raw: RawAudioFrame): AudioFrame {
  return {
    peakL: raw.peakL,
    peakR: raw.peakR,
    rmsL: raw.rmsL,
    rmsR: raw.rmsR,
    scope: Float32Array.from(raw.scope),
    scopeR: Float32Array.from(raw.scopeR),
    spectrum: Float32Array.from(raw.spectrum),
    clip: raw.clip,
  };
}

const EMPTY_FRAME: AudioFrame = {
  peakL: 0,
  peakR: 0,
  rmsL: 0,
  rmsR: 0,
  scope: new Float32Array(512),
  scopeR: new Float32Array(512),
  spectrum: new Float32Array(31),
  clip: false,
};

export class TauriAudioEngine implements AudioEngine {
  private state: EngineState = {
    running: false,
    device: null,
    channelPair: null,
    gainDb: -6,
    muted: false,
    sampleRateIn: 0,
    sampleRateOut: 0,
    latencyMs: 0,
    source: "input",
  };

  private lastFrame: AudioFrame = EMPTY_FRAME;
  private pollInFlight = false;
  private listeners = new Set<(state: EngineState) => void>();
  // Igual que en engine-web.ts: el contrato exige getInputChannelCount() síncrono (ver
  // core/engine.ts), así que se cachea aquí en vez de consultarlo por IPC en cada llamada.
  private inputChannelCount = 2;

  async listInputDevices(): Promise<AudioDeviceInfo[]> {
    const raw = await invoke<RawAudioDeviceInfo[]>("list_input_devices");
    return raw.map((d) => ({ id: d.id, label: d.label, channelCount: d.channelCount }));
  }

  async start(deviceId: string, channelPair?: [number, number]): Promise<void> {
    await invoke("start_engine", { deviceId, channelPair: channelPair ?? null });
    this.inputChannelCount = await invoke<number>("get_input_channel_count");
    await this.refreshState();
  }

  getInputChannelCount(): number {
    return this.inputChannelCount;
  }

  async stop(): Promise<void> {
    await invoke("stop_engine");
    await this.refreshState();
  }

  setSource(source: AudioSource): void {
    this.updateState({ source }); // optimista: la UI no espera el roundtrip para reflejarlo
    void invoke("set_source", { source }).catch((err) => {
      console.error("set_source falló:", err);
    });
  }

  setGainDb(db: number): void {
    const clamped = clampDb(db);
    this.updateState({ gainDb: clamped }); // optimista, igual que setSource
    void invoke("set_gain_db", { db: clamped }).catch((err) => {
      console.error("set_gain_db falló:", err);
    });
  }

  toggleMute(): void {
    this.updateState({ muted: !this.state.muted });
    void invoke("toggle_mute").catch((err) => {
      console.error("toggle_mute falló:", err);
    });
  }

  getState(): EngineState {
    return this.state;
  }

  /**
   * Síncrona por contrato (ver core/engine.ts), pero IPC es siempre async. Se resuelve
   * devolviendo el último frame recibido y disparando la siguiente consulta en segundo plano,
   * sin nunca dejar más de una en vuelo — el propio bucle de rAF del host, llamando a esto en
   * cada frame, ES el mecanismo de polling (ver docs/decisiones/0006-polling-en-raf-vs-eventos.md).
   * También se aprovecha cada ciclo para refrescar el EngineState: un cambio de dispositivo de
   * salida (docs/arquitectura/dispositivos.md) ocurre del lado de Rust sin que nadie lo pida, y
   * como no hay eventos (ADR 0006), solo el polling se entera.
   */
  getFrame(): AudioFrame {
    if (!this.pollInFlight) {
      this.pollInFlight = true;
      Promise.all([
        invoke<RawAudioFrame>("get_frame"),
        invoke<RawEngineState>("get_engine_state"),
      ])
        .then(([frame, state]) => {
          this.lastFrame = toAudioFrame(frame);
          this.updateState(state);
        })
        .catch((err) => console.error("Polling de get_frame/get_engine_state falló:", err))
        .finally(() => {
          this.pollInFlight = false;
        });
    }
    return this.lastFrame;
  }

  onStateChange(cb: (state: EngineState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private async refreshState(): Promise<void> {
    const raw = await invoke<RawEngineState>("get_engine_state");
    this.updateState(raw);
  }

  private updateState(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb(this.state);
  }
}
