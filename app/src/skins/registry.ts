import type { Skin, SkinManifest } from "../core/types";

/** Cada carátula exporta un manifiesto y una fábrica — nunca una instancia singleton, para
 *  poder montar/desmontar limpio en cada cambio de carátula (y, en Fase C, en cada ciclo de
 *  destrucción/reconstrucción de la ventana — ver docs/decisiones/0005-bandeja-y-ventana-destruible.md). */
export interface SkinModule {
  manifest: SkinManifest;
  /** Puede ser asíncrona: una carátula pesada (p. ej. MilkDrop, que arrastra ~900 KB de
   *  presets de butterchurn) se registra con un factory que hace import() dinámico, para que
   *  ese peso solo se descargue si el usuario de verdad la selecciona — no en el bundle
   *  principal. Ver docs/decisiones/0007-dependencias-y-cadena-de-suministro.md. */
  createSkin(): Skin | Promise<Skin>;
}

const registry = new Map<string, SkinModule>();

export function registerSkin(mod: SkinModule): void {
  registry.set(mod.manifest.id, mod);
}

export function getSkin(id: string): SkinModule | undefined {
  return registry.get(id);
}

export function listSkins(): SkinManifest[] {
  return [...registry.values()].map((m) => m.manifest);
}
