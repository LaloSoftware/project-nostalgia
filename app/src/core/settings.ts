// Persistencia de preferencias del usuario: dispositivo, carátula activa, volumen.
//
// En Fase A vive en localStorage. En Fase B se cambia el backend (probablemente un archivo de
// configuración gestionado desde Rust) sin que el resto de la app note la diferencia, porque
// todo el mundo pasa por esta API — nunca por localStorage directamente.

import { clampDb } from "./gain";

export interface PersistedSettings {
  deviceId: string | null;
  channelPair: [number, number] | null;
  gainDb: number;
  skinId: string;
}

const STORAGE_KEY = "nostalgia.settings.v1";

const DEFAULTS: PersistedSettings = {
  deviceId: null,
  channelPair: null,
  gainDb: -6,
  skinId: "console-digital",
};

export function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      deviceId: parsed.deviceId ?? DEFAULTS.deviceId,
      channelPair: parsed.channelPair ?? DEFAULTS.channelPair,
      gainDb: clampDb(parsed.gainDb ?? DEFAULTS.gainDb),
      skinId: parsed.skinId ?? DEFAULTS.skinId,
    };
  } catch {
    // localStorage corrupto o inaccesible (modo privado en algunos navegadores): degradar a
    // valores por defecto en vez de romper el arranque de la app.
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: PersistedSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Mismo caso: si no se puede persistir, la app sigue funcionando solo que sin memoria
    // entre sesiones. No es un error fatal.
  }
}
