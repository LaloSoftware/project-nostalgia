import type { SkinManifest } from "../../core/types";

export const manifest: SkinManifest = {
  id: "milkdrop",
  name: "MilkDrop",
  author: "Nostalgia (sobre butterchurn)",
  // El prototipo de Fase A — ver docs/decisiones/0004-alcance-v1.md y
  // docs/ROADMAP.md ("MilkDrop en el build nativo"). Necesita PCM real vía
  // SkinHostApi.getWebAudioNode(), no el AudioFrame compacto — ver core/types.ts.
  requiresPcm: true,
};
