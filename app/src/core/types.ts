// El contrato de datos entre el motor de audio y las carátulas.
//
// Documentado en detalle en docs/arquitectura/contrato-de-datos.md.
// Romper o extender este contrato de forma incompatible requiere un ADR — ver CLAUDE.md.
//
// A una carátula le da igual si estos datos vienen de un AnalyserNode de Web Audio (Fase A) o
// de un comando Tauri que expone un Mutex<AudioFrame> calculado en Rust (Fase B). Ese límite es
// lo que permite sustituir el motor sin tocar una sola línea de las carátulas.

/** Datos de análisis ya procesados por el motor, listos para dibujar. Nunca audio crudo. */
export interface AudioFrame {
  /** Pico instantáneo por canal, en amplitud lineal [0, 1]. */
  peakL: number;
  peakR: number;
  /** RMS por canal (ventana corta), en amplitud lineal [0, 1]. Para medidores tipo VU. */
  rmsL: number;
  rmsR: number;
  /** Buffer de osciloscopio submuestreado, canal izquierdo, amplitud en [-1, 1]. */
  scope: Float32Array;
  /** Buffer de osciloscopio submuestreado, canal derecho, amplitud en [-1, 1]. */
  scopeR: Float32Array;
  /** Magnitudes de espectro (bandas log-espaciadas), normalizadas a [0, 1]. */
  spectrum: Float32Array;
  /** true si la señal tocó el techo (|muestra| >= 0.99) desde el último frame. */
  clip: boolean;
}

/** De dónde viene el audio que se está monitoreando. */
export type AudioSource = "input" | "testTone";

/** Estado operativo del motor. Es la única fuente de verdad — las carátulas nunca lo mutan. */
export interface EngineState {
  running: boolean;
  /** Nombre del dispositivo de entrada seleccionado (persistencia por nombre, ver
   *  docs/arquitectura/dispositivos.md — cpal no da IDs estables entre reconexiones). */
  device: string | null;
  /** Qué par de canales usar dentro del dispositivo, cuando expone más de 2 (p. ej. la tarjeta
   *  de audio en Windows). null cuando el dispositivo ya es estéreo simple. */
  channelPair: [number, number] | null;
  /** Ganancia master en dB, rango [-60, 6]. */
  gainDb: number;
  muted: boolean;
  sampleRateIn: number;
  sampleRateOut: number;
  /** Latencia de ida y vuelta medida en tiempo real, en milisegundos. */
  latencyMs: number;
  source: AudioSource;
}

/** Metadatos declarativos de una carátula. */
export interface SkinManifest {
  id: string;
  name: string;
  author: string;
  /**
   * true si la carátula necesita PCM crudo además del AudioFrame compacto — el caso de una
   * carátula que envuelve un motor de visualización de terceros con su propio analizador interno
   * (p. ej. la carátula MilkDrop sobre butterchurn). El host solo paga el costo de ese flujo
   * mientras esta carátula está activa. Ver docs/arquitectura/contrato-de-datos.md.
   */
  requiresPcm?: boolean;
}

/** Lo único que una carátula puede pedirle al host. El host decide qué hacer con cada intención
 *  y es la única fuente de verdad del EngineState — la carátula nunca lo edita directamente. */
export interface SkinHostApi {
  setGainDb(db: number): void;
  toggleMute(): void;
  selectDevice(deviceName: string, channelPair?: [number, number]): void;
  setSource(source: AudioSource): void;
  openSettings(): void;
  /**
   * Vía de escape SOLO para carátulas con requiresPcm: true (p. ej. MilkDrop sobre butterchurn,
   * que necesita conectar su propio analizador a un AudioNode real en vez de consumir
   * AudioFrame). Es deliberadamente específica de Web Audio y por tanto solo existe en la
   * Fase A: el motor de engine-web.ts la implementa devolviendo el masterGain post-fader; el
   * motor de Fase B (Rust, sin grafo de Web Audio del lado del host) la deja sin implementar.
   * Antes de que una carátula así entre al build nativo hace falta el puente de PCM evaluado en
   * docs/arquitectura/motor-de-audio.md — esto no lo resuelve, solo lo hace explícito.
   */
  getWebAudioNode?(): AudioNode | null;
}

/** El contrato que implementa cada carátula. */
export interface Skin {
  manifest: SkinManifest;
  /** Se llama una vez al activar la carátula. root: contenedor DOM asignado; host: para emitir
   *  intenciones. */
  mount(root: HTMLElement, host: SkinHostApi): void;
  /** Se llama en cada frame del bucle de dibujo (rAF). */
  render(frame: AudioFrame, state: EngineState): void;
  /** Se llama al desmontar (cambio de carátula o cierre). Libera contextos WebGL, listeners,
   *  timers — cualquier recurso que no deba sobrevivir a la carátula. */
  unmount(): void;
}
