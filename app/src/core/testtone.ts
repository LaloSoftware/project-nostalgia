// Fuente de prueba: oscilador + ruido rosa, para verificar visualizador, volumen y ruta de
// salida sin depender del tocadiscos conectado — ver docs/decisiones/0004-alcance-v1.md.
//
// El ruido rosa se genera una vez como un buffer corto y se reproduce en loop (algoritmo de
// Paul Kellett, una aproximación estándar y barata de -3dB/octava). No se usa un AudioWorklet
// aquí porque no hace falta: es una fuente auxiliar de desarrollo/QA, no parte de la ruta de
// audio crítica.

/** Genera un buffer de ruido rosa de la duración dada, en loop sin costura audible. */
function generatePinkNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    data[i] = pink * 0.11; // compensar la ganancia acumulada del filtro
  }
  return buffer;
}

export interface TestToneSource {
  /** Nodo de salida a conectar en el grafo (p. ej. hacia el masterGain). */
  readonly output: GainNode;
  start(): void;
  stop(): void;
  dispose(): void;
}

/** Tono de prueba: oscilador senoidal a 440 Hz mezclado con ruido rosa a bajo nivel, para
 *  ejercitar tanto el osciloscopio (forma de onda clara) como el analizador de espectro
 *  (contenido en todo el rango, propio del ruido rosa). */
export function createTestTone(context: AudioContext): TestToneSource {
  const output = context.createGain();
  output.gain.value = 1;

  const osc = context.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 440;
  const oscGain = context.createGain();
  oscGain.gain.value = 0.25;
  osc.connect(oscGain).connect(output);

  const noiseBuffer = generatePinkNoiseBuffer(context, 4);
  const noiseSource = context.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;
  const noiseGain = context.createGain();
  noiseGain.gain.value = 0.15;
  noiseSource.connect(noiseGain).connect(output);

  let started = false;

  return {
    output,
    start() {
      if (started) return;
      osc.start();
      noiseSource.start();
      started = true;
    },
    stop() {
      // Nodos de fuente de Web Audio no se pueden reiniciar tras stop(); dispose() los recrea
      // si hace falta arrancar de nuevo. Para el caso de uso (alternar entrada/tono) alcanza con
      // silenciar vía la ganancia del grafo en engine-web.ts en vez de parar/arrancar aquí.
    },
    dispose() {
      try { osc.stop(); } catch { /* ya detenido */ }
      try { noiseSource.stop(); } catch { /* ya detenido */ }
      osc.disconnect();
      oscGain.disconnect();
      noiseSource.disconnect();
      noiseGain.disconnect();
      output.disconnect();
    },
  };
}
