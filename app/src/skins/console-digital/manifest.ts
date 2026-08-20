import type { SkinManifest } from "../../core/types";

export const manifest: SkinManifest = {
  id: "console-digital",
  name: "Consola Digital",
  author: "Nostalgia",
  // No necesita PCM crudo: todo su visualizador se construye con el AudioFrame compacto
  // (osciloscopio, espectro, picos/RMS). Contrasta con la carátula MilkDrop — ver
  // docs/arquitectura/contrato-de-datos.md.
};
