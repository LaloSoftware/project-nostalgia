//! Tono de prueba: oscilador senoidal + ruido rosa, generado muestra a muestra dentro del
//! callback de salida. Ver docs/decisiones/0004-alcance-v1.md.
//!
//! Es realtime-safe a propósito: el ruido rosa se precalcula UNA VEZ en `new()` (no dentro del
//! callback) y se reproduce en loop; el oscilador es una recurrencia trigonométrica sin
//! asignaciones. Nada aquí asigna memoria después de construirse — ver la regla de "cero
//! asignaciones en el callback" en CLAUDE.md.

const SINE_FREQ_HZ: f32 = 440.0;
const SINE_GAIN: f32 = 0.25;
const NOISE_GAIN: f32 = 0.15;
const NOISE_SECONDS: f32 = 4.0;

/// Ruido rosa aproximado con el filtro de Paul Kellett (-3 dB/octava), igual que
/// app/src/core/testtone.ts en la Fase A — mismo algoritmo en ambos lados a propósito, para que
/// el tono de prueba suene igual sin importar qué motor esté activo.
fn generate_pink_noise(sample_rate: f32, seconds: f32) -> Vec<f32> {
    let length = (sample_rate * seconds) as usize;
    let mut data = Vec::with_capacity(length);
    let (mut b0, mut b1, mut b2, mut b3, mut b4, mut b5, mut b6) =
        (0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32);

    // Generador determinista (xorshift) en vez de `rand`: evita añadir una dependencia solo
    // para generar ruido una vez al arrancar — ver CLAUDE.md, política de dependencias.
    let mut seed: u32 = 0x9E3779B9;
    let mut next_white = || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        (seed as f32 / u32::MAX as f32) * 2.0 - 1.0
    };

    for _ in 0..length {
        let white = next_white();
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        let pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data.push(pink * 0.11);
    }
    data
}

pub struct TestTone {
    sample_rate: f32,
    phase: f32,
    noise: Vec<f32>,
    noise_pos: usize,
}

impl TestTone {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            phase: 0.0,
            noise: generate_pink_noise(sample_rate, NOISE_SECONDS),
            noise_pos: 0,
        }
    }

    /// Siguiente muestra mono (el llamador la copia a ambos canales — el tono de prueba es
    /// idéntico en L/R, no hay nada que estereofonizar).
    #[inline]
    pub fn next_sample(&mut self) -> f32 {
        let sine = (self.phase * std::f32::consts::TAU).sin() * SINE_GAIN;
        self.phase += SINE_FREQ_HZ / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let noise = self.noise[self.noise_pos] * NOISE_GAIN;
        self.noise_pos = (self.noise_pos + 1) % self.noise.len();

        sine + noise
    }
}
