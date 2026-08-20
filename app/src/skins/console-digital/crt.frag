#version 300 es
precision highp float;

// Post-proceso de un solo pase sobre el canvas 2D donde se dibuja el contenido de la consola
// (osciloscopio, espectro, medidores). Escrito a mano en vez de con three/postprocessing —
// ver docs/decisiones/0007-dependencias-y-cadena-de-suministro.md: desproporcionado meter un
// motor 3D completo para un efecto 2D de un solo pase.
//
// Deliberadamente NO se usa shadowBlur de Canvas2D por frame para el brillo de fósforo (es la
// causa número uno de que un visualizador consuma 25% de CPU en vez de 3%); el "glow" de aquí
// es un blur barato de pocas muestras hecho en la GPU, una sola vez por frame sobre toda la
// escena, no por cada elemento dibujado.

uniform sampler2D uSource;
uniform vec2 uResolution;
uniform float uTime;

in vec2 vUv;
out vec4 fragColor;

// Distorsión de barril sutil: simula la curvatura de un tubo CRT sin exagerar.
vec2 barrel(vec2 uv) {
  vec2 centered = uv * 2.0 - 1.0;
  float r2 = dot(centered, centered);
  centered *= 1.0 + 0.045 * r2;
  return centered * 0.5 + 0.5;
}

void main() {
  vec2 uv = barrel(vUv);

  // Fuera del área curvada: negro, como el borde de un tubo real.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Aberración cromática leve: cada canal muestrea con un desplazamiento distinto.
  float aberration = 0.0016;
  float r = texture(uSource, uv + vec2(aberration, 0.0)).r;
  float g = texture(uSource, uv).g;
  float b = texture(uSource, uv - vec2(aberration, 0.0)).b;
  vec3 color = vec3(r, g, b);

  // Brillo de fósforo: unas pocas muestras vecinas sumadas con poco peso, en vez de un blur
  // gaussiano completo — barato y suficiente para el efecto buscado.
  vec2 texel = 1.0 / uResolution;
  vec3 glow = vec3(0.0);
  glow += texture(uSource, uv + texel * vec2(1.5, 0.0)).rgb;
  glow += texture(uSource, uv - texel * vec2(1.5, 0.0)).rgb;
  glow += texture(uSource, uv + texel * vec2(0.0, 1.5)).rgb;
  glow += texture(uSource, uv - texel * vec2(0.0, 1.5)).rgb;
  color += glow * 0.10;

  // Líneas de barrido: oscurecen ligeramente filas alternas, moduladas por la resolución real
  // para que no aparezcan ni demasiado finas ni demasiado gruesas según el tamaño de ventana.
  float scanline = 0.92 + 0.08 * sin(uv.y * uResolution.y * 3.14159);
  color *= scanline;

  // Parpadeo casi imperceptible, como un refresco de tubo real, no un "efecto" evidente.
  color *= 0.985 + 0.015 * sin(uTime * 6.0);

  // Viñeta suave.
  vec2 centered = uv - 0.5;
  float vignette = 1.0 - dot(centered, centered) * 0.35;
  color *= vignette;

  fragColor = vec4(color, 1.0);
}
