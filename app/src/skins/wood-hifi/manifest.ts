import type { SkinManifest } from "../../core/types";

export const manifest: SkinManifest = {
  id: "wood-hifi",
  name: "Hi-Fi de Madera",
  author: "Nostalgia",
  // Deliberadamente opuesta a la Consola Digital: sin canvas, sin WebGL, sin los iconos de
  // trazo del shell (dibuja sus propios interruptores). Existe para probar que el contrato de
  // carátulas es real y no una promesa vacía — ver docs/decisiones/0004-alcance-v1.md.
};
