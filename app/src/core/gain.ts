// Conversión dB <-> lineal para el volumen master. Compartido entre el motor y la UI (el
// slider de la perilla trabaja en dB, Web Audio y los cálculos de nivel trabajan en lineal).

export const MIN_DB = -60;
export const MAX_DB = 6;

export function clampDb(db: number): number {
  return Math.min(MAX_DB, Math.max(MIN_DB, db));
}

/** -60 dB se trata como silencio absoluto (0 lineal), no como una atenuación extrema audible. */
export function dbToLinear(db: number): number {
  if (db <= MIN_DB) return 0;
  return Math.pow(10, db / 20);
}

export function linearToDb(linear: number): number {
  if (linear <= 0) return MIN_DB;
  return 20 * Math.log10(linear);
}
