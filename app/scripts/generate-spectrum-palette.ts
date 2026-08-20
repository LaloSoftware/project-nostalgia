// Genera la rampa de color del espectro/medidores de la Consola Digital, interpolando en OKLCH
// en vez de sRGB. Ver docs/decisiones/0007-dependencias-y-cadena-de-suministro.md: un degradado
// en sRGB se enloda y se agrisa en el medio; en OKLCH mantiene el croma y avanza de forma
// perceptualmente uniforme.
//
// Se ejecuta en build time (`pnpm generate:palette`) y escribe un array estático de hex. `culori`
// es una devDependency: todo el beneficio estético, cero huella en el bundle de producción.
//
// Regenerar tras tocar los colores de referencia de abajo, y commitear el archivo resultante —
// no se ejecuta como parte del build normal para no depender de una devDependency en CI.

import { interpolate, formatHex } from "culori";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Rampa clásica de VU digital: verde fósforo apagado -> verde brillante -> ámbar -> rojo de clip.
const STOPS = ["oklch(35% 0.09 155)", "oklch(78% 0.19 150)", "oklch(80% 0.17 80)", "oklch(63% 0.24 25)"];
const STEPS = 64;

const ramp = interpolate(STOPS, "oklch");
const palette: string[] = [];
for (let i = 0; i < STEPS; i++) {
  const t = i / (STEPS - 1);
  palette.push(formatHex(ramp(t)));
}

const outPath = fileURLToPath(new URL("../src/skins/console-digital/palette.ts", import.meta.url));
const contents = `// GENERADO por scripts/generate-spectrum-palette.ts — no editar a mano.
// Ver docs/decisiones/0007-dependencias-y-cadena-de-suministro.md.

/** ${STEPS} tonos de verde fósforo -> ámbar -> rojo, interpolados en OKLCH. Índice 0 = nivel
 *  más bajo, índice ${STEPS - 1} = clip. */
export const SPECTRUM_PALETTE: readonly string[] = ${JSON.stringify(palette, null, 2)};
`;

writeFileSync(outPath, contents, "utf-8");
console.log(`Paleta escrita en ${outPath} (${STEPS} tonos)`);
