import type { AudioEngine, AudioDeviceInfo } from "./engine";
import type { AudioFrame, AudioSource, EngineState } from "./types";
import { clampDb, dbToLinear, MIN_DB, MAX_DB } from "./gain";
import { createTestTone, type TestToneSource } from "./testtone";

// Motor de audio de la Fase A — ver docs/decisiones/0003-orden-frontend-primero.md.
//
// Cadena de audio (ver docs/arquitectura/vision-general.md):
//
//   getUserMedia ─▶ MediaStreamSource ─▶ inputSourceGain ─┐
//                                                         ├─▶ masterGain ─┬─▶ destination
//                          createTestTone() ─▶ testToneGain ┘             └─▶ splitter ─▶ [analyserL, analyserR]
//                                                                          (masterGain también alimenta un analyser
//                                                                           mono sin dividir, para el espectro)
//
// Constantes importantes:
// - Constraints de getUserMedia con AGC/eco/ruido desactivados: sin esto Chromium procesa la
//   señal como si fuera una llamada de voz y arruina el audio de música.
// - inputSourceGain / testToneGain permiten alternar de fuente sin reconstruir el grafo, con una
//   rampa corta para no producir un clic al cambiar.

const SCOPE_SIZE = 512; // muestras de tiempo por canal, ya submuestreado por el AnalyserNode
const SPECTRUM_BINS = 31; // bandas log-espaciadas, análogas a un ecualizador gráfico
const FFT_SIZE = 2048;

function makeEmptyFrame(): AudioFrame {
  return {
    peakL: 0,
    peakR: 0,
    rmsL: 0,
    rmsR: 0,
    scope: new Float32Array(SCOPE_SIZE),
    scopeR: new Float32Array(SCOPE_SIZE),
    spectrum: new Float32Array(SPECTRUM_BINS),
    clip: false,
  };
}

export class WebAudioEngine implements AudioEngine {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private inputSourceGain: GainNode | null = null;
  private testToneGain: GainNode | null = null;
  private testTone: TestToneSource | null = null;
  private masterGain: GainNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private analyserMono: AnalyserNode | null = null;

  // Buffers reutilizados entre llamadas a getFrame() para no asignar en cada frame de rAF.
  private timeL = new Float32Array(FFT_SIZE);
  private timeR = new Float32Array(FFT_SIZE);
  private freqMono = new Float32Array(FFT_SIZE / 2);
  private frame = makeEmptyFrame();

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

  private listeners = new Set<(state: EngineState) => void>();
  private inputChannelCount = 2;

  async listInputDevices(): Promise<AudioDeviceInfo[]> {
    // enumerateDevices() no expone labels ni conteo de canales fiable sin permiso previo de
    // getUserMedia. Se pide un permiso mínimo y se libera de inmediato solo para poblar labels.
    let probe: MediaStream | null = null;
    try {
      probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // El usuario puede listar sin labels si aún no ha dado permiso; se resuelve al seleccionar.
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    probe?.getTracks().forEach((t) => t.stop());

    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({
        id: d.deviceId,
        label: d.label || "Entrada de audio",
        // Web Audio / MediaDevices no expone el conteo real de canales antes de abrir el
        // stream; se asume estéreo aquí y se corrige, si hace falta, tras start().
        channelCount: 2,
      }));
  }

  async start(deviceId: string, _channelPair?: [number, number]): Promise<void> {
    if (this.context) await this.stop();

    const context = new AudioContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
    });

    const sourceNode = context.createMediaStreamSource(stream);

    const inputSourceGain = context.createGain();
    const testToneGain = context.createGain();
    const testTone = createTestTone(context);
    testTone.output.connect(testToneGain);
    testTone.start();

    const masterGain = context.createGain();
    const splitter = context.createChannelSplitter(2);
    const analyserL = context.createAnalyser();
    const analyserR = context.createAnalyser();
    const analyserMono = context.createAnalyser();
    for (const a of [analyserL, analyserR, analyserMono]) {
      a.fftSize = FFT_SIZE;
      a.smoothingTimeConstant = 0.6;
    }

    sourceNode.connect(inputSourceGain).connect(masterGain);
    testToneGain.connect(masterGain);
    masterGain.connect(context.destination);

    // Taps de análisis: no necesitan conectarse más allá del analyser (patrón estándar).
    masterGain.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    masterGain.connect(analyserMono);

    this.context = context;
    this.stream = stream;
    this.sourceNode = sourceNode;
    this.inputSourceGain = inputSourceGain;
    this.testToneGain = testToneGain;
    this.testTone = testTone;
    this.masterGain = masterGain;
    this.splitter = splitter;
    this.analyserL = analyserL;
    this.analyserR = analyserR;
    this.analyserMono = analyserMono;

    const track = stream.getAudioTracks()[0];
    const deviceLabel = track?.label ?? this.state.device ?? "Entrada de audio";
    // Solo se conoce el conteo real de canales tras abrir el stream — ver
    // docs/arquitectura/dispositivos.md.
    this.inputChannelCount = track?.getSettings().channelCount ?? 2;

    this.applySourceGains(this.state.source);
    this.applyGain();

    this.updateState({
      running: true,
      device: deviceLabel,
      sampleRateIn: context.sampleRate,
      sampleRateOut: context.sampleRate,
      // Web Audio unifica entrada y salida a la tasa del AudioContext (el navegador resamplea
      // internamente); por eso aquí ambas son iguales. En Fase B, con dispositivos nativos
      // independientes, pueden diferir de verdad — ver docs/arquitectura/correccion-de-deriva.md.
      latencyMs: this.estimateLatencyMs(context),
    });
  }

  async stop(): Promise<void> {
    this.testTone?.dispose();
    this.sourceNode?.disconnect();
    this.inputSourceGain?.disconnect();
    this.testToneGain?.disconnect();
    this.masterGain?.disconnect();
    this.splitter?.disconnect();
    this.analyserL?.disconnect();
    this.analyserR?.disconnect();
    this.analyserMono?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.context?.close();

    this.context = null;
    this.stream = null;
    this.sourceNode = null;
    this.inputSourceGain = null;
    this.testToneGain = null;
    this.testTone = null;
    this.masterGain = null;
    this.splitter = null;
    this.analyserL = null;
    this.analyserR = null;
    this.analyserMono = null;

    this.updateState({ running: false });
  }

  setSource(source: AudioSource): void {
    this.applySourceGains(source);
    this.updateState({ source });
  }

  private applySourceGains(source: AudioSource): void {
    const ctx = this.context;
    if (!ctx || !this.inputSourceGain || !this.testToneGain) return;
    const now = ctx.currentTime;
    const RAMP = 0.05; // 50 ms: suficiente para evitar clic, imperceptible como crossfade
    this.inputSourceGain.gain.setTargetAtTime(source === "input" ? 1 : 0, now, RAMP);
    this.testToneGain.gain.setTargetAtTime(source === "testTone" ? 1 : 0, now, RAMP);
  }

  setGainDb(db: number): void {
    this.updateState({ gainDb: clampDb(db) });
    this.applyGain();
  }

  toggleMute(): void {
    this.updateState({ muted: !this.state.muted });
    this.applyGain();
  }

  private applyGain(): void {
    const ctx = this.context;
    if (!ctx || !this.masterGain) return;
    const target = this.state.muted ? 0 : dbToLinear(this.state.gainDb);
    // setTargetAtTime evita el "zipper noise" de asignar gain.value directamente.
    this.masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.02);
  }

  private estimateLatencyMs(context: AudioContext): number {
    // Mejor esfuerzo en Web Audio: no incluye la latencia propia del dispositivo de entrada
    // USB, que el navegador no expone. La Fase B mide la latencia real de punta a punta.
    const out = (context as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    const base = context.baseLatency ?? 0;
    return (out || base) * 1000;
  }

  getState(): EngineState {
    return this.state;
  }

  getInputChannelCount(): number {
    return this.inputChannelCount;
  }

  getFrame(): AudioFrame {
    if (!this.analyserL || !this.analyserR || !this.analyserMono) {
      return this.frame;
    }

    this.analyserL.getFloatTimeDomainData(this.timeL);
    this.analyserR.getFloatTimeDomainData(this.timeR);
    this.analyserMono.getFloatFrequencyData(this.freqMono);

    let peakL = 0, sumSqL = 0;
    for (let i = 0; i < SCOPE_SIZE; i++) {
      const v = this.timeL[i];
      this.frame.scope[i] = v;
      const abs = Math.abs(v);
      if (abs > peakL) peakL = abs;
      sumSqL += v * v;
    }
    let peakR = 0, sumSqR = 0;
    for (let i = 0; i < SCOPE_SIZE; i++) {
      const v = this.timeR[i];
      this.frame.scopeR[i] = v;
      const abs = Math.abs(v);
      if (abs > peakR) peakR = abs;
      sumSqR += v * v;
    }

    this.frame.peakL = peakL;
    this.frame.peakR = peakR;
    this.frame.rmsL = Math.sqrt(sumSqL / SCOPE_SIZE);
    this.frame.rmsR = Math.sqrt(sumSqR / SCOPE_SIZE);
    this.frame.clip = peakL >= 0.99 || peakR >= 0.99;

    // freqMono está en dB (típicamente [-100, 0]); se remapea a bandas log-espaciadas en [0, 1].
    const minDb = this.analyserMono.minDecibels;
    const maxDb = this.analyserMono.maxDecibels;
    const nyquist = this.context ? this.context.sampleRate / 2 : 24000;
    const minFreq = 30;
    const maxFreq = Math.min(16000, nyquist);
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);

    for (let b = 0; b < SPECTRUM_BINS; b++) {
      const t = b / (SPECTRUM_BINS - 1);
      const freq = Math.pow(10, logMin + t * (logMax - logMin));
      const bin = Math.round((freq / nyquist) * (this.freqMono.length - 1));
      const db = this.freqMono[Math.min(bin, this.freqMono.length - 1)];
      this.frame.spectrum[b] = Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)));
    }

    return this.frame;
  }

  onStateChange(cb: (state: EngineState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Para carátulas con requiresPcm: true (MilkDrop/butterchurn) — ver core/engine.ts y
   *  core/types.ts. Expone el nodo post-fader: butterchurn ve la señal ya con el volumen
   *  master aplicado, igual que la salida real. */
  getWebAudioNode(): AudioNode | null {
    return this.masterGain;
  }

  private updateState(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb(this.state);
  }
}

export { MIN_DB, MAX_DB };
