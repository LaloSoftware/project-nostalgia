// butterchurn y butterchurn-presets no publican tipos — declaración ambiental mínima con la
// superficie que Nostalgia realmente usa (ver src/skins/milkdrop/skin.ts). Ver
// docs/decisiones/0007-dependencias-y-cadena-de-suministro.md.

declare module "butterchurn" {
  export interface ButterchurnVisualizer {
    connectAudio(node: AudioNode): void;
    loadPreset(preset: unknown, blendSeconds: number): void;
    setRendererSize(width: number, height: number): void;
    render(): void;
  }

  interface CreateVisualizerOptions {
    width: number;
    height: number;
    pixelRatio?: number;
    textureRatio?: number;
  }

  const butterchurn: {
    createVisualizer(
      context: AudioContext,
      canvas: HTMLCanvasElement,
      options: CreateVisualizerOptions,
    ): ButterchurnVisualizer;
  };
  export default butterchurn;
}

declare module "butterchurn-presets" {
  const butterchurnPresets: {
    getPresets(): Record<string, unknown>;
  };
  export default butterchurnPresets;
}
