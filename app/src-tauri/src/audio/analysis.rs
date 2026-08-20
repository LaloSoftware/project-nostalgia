//! Análisis para el visualizador de las carátulas — hilo NO realtime. Toma un tap del audio de
//! salida (post-ganancia, después de que el callback de salida decide qué suena) y calcula
//! picos/RMS, el buffer de osciloscopio y el espectro, dejándolos en un `Mutex<AudioFrame>` que
//! el frontend consulta por polling (`get_frame`, ver `commands.rs` y
//! docs/decisiones/0006-polling-en-raf-vs-eventos.md).
//!
//! El cálculo del espectro replica a propósito el de `app/src/core/engine-web.ts` (mismas
//! constantes: 31 bandas log-espaciadas 30 Hz–16 kHz, rango -100..-30 dB) para que una carátula
//! se vea igual sin importar qué motor esté activo.

use rtrb::Consumer;
use rustfft::num_complex::Complex32;
use rustfft::FftPlanner;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const SCOPE_SIZE: usize = 512;
const SPECTRUM_BINS: usize = 31;
const FFT_SIZE: usize = 2048;
const MIN_DB: f32 = -100.0;
const MAX_DB: f32 = -30.0;
/// Cota superior de refresco del análisis — de sobra frente a los ~60 Hz a los que el frontend
/// hace polling con get_frame() (ver ADR 0006); no tiene sentido recalcular más rápido que eso.
const MIN_RECOMPUTE_INTERVAL: Duration = Duration::from_millis(8);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioFrame {
    pub peak_l: f32,
    pub peak_r: f32,
    pub rms_l: f32,
    pub rms_r: f32,
    pub scope: Vec<f32>,
    pub scope_r: Vec<f32>,
    pub spectrum: Vec<f32>,
    pub clip: bool,
}

impl Default for AudioFrame {
    fn default() -> Self {
        Self {
            peak_l: 0.0,
            peak_r: 0.0,
            rms_l: 0.0,
            rms_r: 0.0,
            scope: vec![0.0; SCOPE_SIZE],
            scope_r: vec![0.0; SCOPE_SIZE],
            spectrum: vec![0.0; SPECTRUM_BINS],
            clip: false,
        }
    }
}

/// Ventana de Hann — reduce el goteo espectral (spectral leakage) del FFT. Web Audio aplica un
/// enventanado equivalente (Blackman) por dentro de `AnalyserNode`; en Rust no viene gratis, así
/// que se aplica a mano.
fn hann_window(n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n - 1) as f32).cos())
        .collect()
}

pub fn spawn_analysis_thread(
    mut tap_consumer: Consumer<f32>,
    sample_rate: f32,
    shared_frame: Arc<Mutex<AudioFrame>>,
    running: Arc<AtomicBool>,
) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name("nostalgia-analysis".into())
        .spawn(move || {
            let mut hist_l: VecDeque<f32> = VecDeque::with_capacity(FFT_SIZE);
            let mut hist_r: VecDeque<f32> = VecDeque::with_capacity(FFT_SIZE);

            let window = hann_window(FFT_SIZE);
            let mut planner = FftPlanner::<f32>::new();
            let fft = planner.plan_fft_forward(FFT_SIZE);
            let mut fft_buf = vec![Complex32::new(0.0, 0.0); FFT_SIZE];

            let nyquist = sample_rate / 2.0;
            let min_freq = 30.0f32;
            let max_freq = 16_000.0f32.min(nyquist);
            let log_min = min_freq.log10();
            let log_max = max_freq.log10();

            let mut last_compute = Instant::now();

            while running.load(Ordering::Relaxed) {
                let mut popped_any = false;
                while let Ok(l) = tap_consumer.pop() {
                    let r = tap_consumer.pop().unwrap_or(l);
                    if hist_l.len() == FFT_SIZE {
                        hist_l.pop_front();
                    }
                    if hist_r.len() == FFT_SIZE {
                        hist_r.pop_front();
                    }
                    hist_l.push_back(l);
                    hist_r.push_back(r);
                    popped_any = true;
                }

                if !popped_any {
                    std::thread::sleep(Duration::from_millis(2));
                    continue;
                }
                if hist_l.len() < SCOPE_SIZE || last_compute.elapsed() < MIN_RECOMPUTE_INTERVAL {
                    continue;
                }
                last_compute = Instant::now();

                // Picos y RMS sobre las últimas SCOPE_SIZE muestras — igual que engine-web.ts.
                let (mut peak_l, mut sum_sq_l) = (0.0f32, 0.0f32);
                for &v in hist_l.iter().rev().take(SCOPE_SIZE) {
                    peak_l = peak_l.max(v.abs());
                    sum_sq_l += v * v;
                }
                let (mut peak_r, mut sum_sq_r) = (0.0f32, 0.0f32);
                for &v in hist_r.iter().rev().take(SCOPE_SIZE) {
                    peak_r = peak_r.max(v.abs());
                    sum_sq_r += v * v;
                }
                let rms_l = (sum_sq_l / SCOPE_SIZE as f32).sqrt();
                let rms_r = (sum_sq_r / SCOPE_SIZE as f32).sqrt();
                let clip = peak_l >= 0.99 || peak_r >= 0.99;

                let scope: Vec<f32> = hist_l.iter().rev().take(SCOPE_SIZE).rev().copied().collect();
                let scope_r: Vec<f32> = hist_r.iter().rev().take(SCOPE_SIZE).rev().copied().collect();

                // Espectro: solo si hay historial suficiente para una ventana completa de FFT.
                let spectrum = if hist_l.len() == FFT_SIZE {
                    for (i, ((&l, &r), w)) in hist_l
                        .iter()
                        .zip(hist_r.iter())
                        .zip(window.iter())
                        .enumerate()
                    {
                        let mono = (l + r) * 0.5;
                        fft_buf[i] = Complex32::new(mono * w, 0.0);
                    }
                    fft.process(&mut fft_buf);

                    let mut bins = vec![0.0f32; SPECTRUM_BINS];
                    for (b, bin) in bins.iter_mut().enumerate() {
                        let t = b as f32 / (SPECTRUM_BINS - 1) as f32;
                        let freq = 10f32.powf(log_min + t * (log_max - log_min));
                        let idx = ((freq / nyquist) * (FFT_SIZE / 2 - 1) as f32).round() as usize;
                        let idx = idx.min(FFT_SIZE / 2 - 1);
                        let magnitude = fft_buf[idx].norm() / (FFT_SIZE as f32).sqrt();
                        let db = 20.0 * magnitude.max(1e-10).log10();
                        *bin = ((db - MIN_DB) / (MAX_DB - MIN_DB)).clamp(0.0, 1.0);
                    }
                    bins
                } else {
                    vec![0.0; SPECTRUM_BINS]
                };

                if let Ok(mut frame) = shared_frame.lock() {
                    frame.peak_l = peak_l;
                    frame.peak_r = peak_r;
                    frame.rms_l = rms_l;
                    frame.rms_r = rms_r;
                    frame.scope = scope;
                    frame.scope_r = scope_r;
                    frame.spectrum = spectrum;
                    frame.clip = clip;
                }
            }
        })
        .expect("no se pudo crear el hilo de análisis")
}
