import type { AudioFrame, AudioSource, EngineState } from "./types";

/**
 * Interfaz que implementa el motor de audio. En Fase A la implementa engine-web.ts sobre Web
 * Audio; en Fase B la implementa engine-tauri.ts sobre comandos Tauri hacia el motor Rust. El
 * resto de la aplicación (shell, carátulas) programa contra esta interfaz, nunca contra una
 * implementación concreta — ver docs/decisiones/0003-orden-frontend-primero.md.
 */
export interface AudioEngine {
  /** Dispositivos de entrada disponibles, tal como los reporta la plataforma. */
  listInputDevices(): Promise<AudioDeviceInfo[]>;

  /** Conteo real de canales del dispositivo activo. Solo se conoce con certeza después de
   *  start() — ver docs/arquitectura/dispositivos.md sobre por qué el selector de par de
   *  canales solo aparece cuando esto es > 2 (el caso de la tarjeta de audio en Windows). */
  getInputChannelCount(): number;

  /** Arranca el monitoreo con el dispositivo y par de canales dados. */
  start(deviceId: string, channelPair?: [number, number]): Promise<void>;

  /** Detiene el monitoreo. El estado persiste (dispositivo, ganancia) para el próximo start(). */
  stop(): Promise<void>;

  /** Cambia entre la entrada real y el tono de prueba sin recrear el grafo de audio. */
  setSource(source: AudioSource): void;

  setGainDb(db: number): void;
  toggleMute(): void;

  /** Snapshot del estado actual. Se consulta, no se suscribe — ver ADR 0006 sobre polling. */
  getState(): EngineState;

  /** Frame de análisis más reciente, para dibujar en el bucle de rAF de la carátula activa. */
  getFrame(): AudioFrame;

  /** Notifica cambios de EngineState que no vienen de una llamada directa (p. ej. el dispositivo
   *  de entrada se desconectó). No reemplaza al polling de getFrame() para el audio en sí. */
  onStateChange(cb: (state: EngineState) => void): () => void;

  /** Vía de escape específica de Web Audio para carátulas con requiresPcm: true — ver el
   *  comentario homónimo en core/types.ts (SkinHostApi). Solo engine-web.ts la implementa. */
  getWebAudioNode?(): AudioNode | null;
}

export interface AudioDeviceInfo {
  id: string;
  label: string;
  channelCount: number;
}
