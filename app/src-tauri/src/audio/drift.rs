//! Corrección de deriva de reloj entre el dispositivo de entrada y el de salida — la parte más
//! delicada del proyecto. Ver docs/arquitectura/correccion-de-deriva.md para la explicación
//! completa del problema (hasta 100 ppm de desajuste entre cristales, ~5000 muestras de
//! desfase por cara de LP sin corregir).
//!
//! Este módulo tiene dos piezas deliberadamente separadas:
//! - `DriftController`: matemática pura, sin I/O — un controlador PI que traduce "qué tan lleno
//!   está el buffer" en "cuánto hay que ajustar el ratio de resampleo". Testeable de forma
//!   aislada (ver los tests al final).
//! - `spawn_resampler_thread`: el pegamento real con `rtrb` y `rubato`. Corre en su PROPIO hilo,
//!   separado de los callbacks de audio en tiempo real de `passthrough.rs` — puede permitirse
//!   asignar memoria y bloquearse brevemente porque no es el callback que toca el hardware. Las
//!   reglas de "cero asignaciones / cero locks" de CLAUDE.md aplican a los callbacks de cpal, no
//!   a este hilo.

use audioadapter_buffers::direct::InterleavedSlice;
use rtrb::{Consumer, Producer};
use rubato::{Adjustable, Async, FixedAsync, PolynomialDegree, Resampler};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Frames de salida por bloque de resampleo. Un valor de compromiso: más grande = menos
/// llamadas por segundo (menos overhead), más pequeño = el controlador de deriva reacciona más
/// rápido. ~10 ms a 48 kHz.
const OUTPUT_CHUNK_FRAMES: usize = 512;
/// Cuánto puede alejarse el ratio del valor base — ver docs/arquitectura/correccion-de-deriva.md:
/// el ajuste real que aplica el controlador está acotado a ±0.5%; este 5% es solo margen de
/// construcción del resampler, no el límite operativo.
const MAX_RESAMPLE_RATIO_RELATIVE: f64 = 1.05;

/// Controlador PI (proporcional + integral) que mantiene el nivel de llenado del ring buffer de
/// entrada cerca del 50%, ajustando el ratio de resampleo en un rango acotado e inaudible.
///
/// Convención de signos (fácil de invertir por error, documentada explícitamente):
/// con `FixedAsync::Output` (salida de tamaño fijo), subir el ratio (salida/entrada) hace que el
/// resampler consuma MENOS frames de entrada por bloque de salida. Por tanto, si el buffer de
/// entrada está demasiado lleno (`fill_fraction > 0.5`, entra más rápido de lo que se drena),
/// hay que consumir MÁS entrada por bloque — es decir, hay que BAJAR el ratio. La corrección es
/// negativa cuando el error es positivo.
pub struct DriftController {
    kp: f64,
    ki: f64,
    integral: f64,
    max_correction: f64,
}

impl DriftController {
    pub fn new() -> Self {
        // Ganancias conservadoras: priorizan estabilidad sobre velocidad de convergencia. Un
        // desajuste de reloj típico (10-100 ppm) es una perturbación lenta; no hace falta
        // reaccionar rápido, hace falta no oscilar ni nunca sonar.
        Self::with_gains(0.02, 0.002, 0.005)
    }

    pub fn with_gains(kp: f64, ki: f64, max_correction: f64) -> Self {
        Self { kp, ki, integral: 0.0, max_correction }
    }

    /// `fill_fraction`: 0.0 (vacío) .. 1.0 (lleno) del ring buffer de entrada.
    /// `dt_secs`: tiempo transcurrido desde la última llamada.
    /// Devuelve el ratio RELATIVO a pasar a `set_resample_ratio_relative` (1.0 = sin corrección).
    pub fn update(&mut self, fill_fraction: f64, dt_secs: f64) -> f64 {
        let error = fill_fraction - 0.5;

        self.integral += error * dt_secs;
        // Anti-windup: sin este límite, un underrun/overrun sostenido (p. ej. al arrancar, con
        // el buffer todavía vacío) satura el término integral y el controlador tarda en
        // recuperarse cuando la condición termina.
        let integral_limit = self.max_correction / self.ki.max(1e-9);
        self.integral = self.integral.clamp(-integral_limit, integral_limit);

        let correction = -(self.kp * error + self.ki * self.integral);
        let correction = correction.clamp(-self.max_correction, self.max_correction);
        1.0 + correction
    }
}

impl Default for DriftController {
    fn default() -> Self {
        Self::new()
    }
}

/// Arranca el hilo de resampleo: lee de `consumer_in` (ring buffer A, crudo desde el callback de
/// entrada), resamplea con ratio variable, y escribe en `producer_out` (ring buffer B, que el
/// callback de salida consume ya lista para reproducir — ver `passthrough.rs`).
///
/// Refinamiento sobre el diagrama original de docs/arquitectura/motor-de-audio.md: el resampleo
/// NO ocurre dentro del callback de salida, sino en este hilo dedicado. La razón es doble: (1)
/// `rubato` asigna memoria internamente y no es seguro invocarlo desde un callback de tiempo
/// real; (2) mantiene los callbacks de cpal triviales (copiar muestras, aplicar ganancia), que
/// es justamente lo que CLAUDE.md exige. El costo es una latencia añadida acotada por el tamaño
/// de los ring buffers, no por este hilo en sí.
///
/// Devuelve `consumer_in` al terminar (cuando `running` pasa a `false`), no `()`: es lo que
/// permite reconstruir SOLO la salida cuando cambia el dispositivo de salida por defecto del
/// sistema, sin recrear el stream de entrada — ver `Engine::on_output_device_changed` en
/// `audio/mod.rs`. Sin esto, cambiar de salida cortaría también la sesión de entrada.
pub fn spawn_resampler_thread(
    mut consumer_in: Consumer<f32>,
    mut producer_out: Producer<f32>,
    sample_rate_in: f32,
    sample_rate_out: f32,
    running: Arc<AtomicBool>,
) -> JoinHandle<Consumer<f32>> {
    std::thread::Builder::new()
        .name("nostalgia-resampler".into())
        .spawn(move || {
            let base_ratio = sample_rate_out as f64 / sample_rate_in as f64;
            let mut resampler = match Async::<f32>::new_poly(
                base_ratio,
                MAX_RESAMPLE_RATIO_RELATIVE,
                PolynomialDegree::Cubic,
                OUTPUT_CHUNK_FRAMES,
                2,
                FixedAsync::Output,
            ) {
                Ok(r) => r,
                Err(e) => {
                    log::error!("No se pudo crear el resampler: {e}");
                    return consumer_in;
                }
            };

            let capacity_frames = consumer_in.buffer().capacity() / 2;
            let mut controller = DriftController::new();
            let mut last_tick = Instant::now();

            let mut scratch_in: Vec<f32> = Vec::with_capacity(capacity_frames * 2);
            let mut scratch_out = vec![0.0f32; OUTPUT_CHUNK_FRAMES * 2];

            while running.load(Ordering::Relaxed) {
                // 1. Medir el llenado ANTES de tocar el ratio o consumir — refleja el estado
                //    real que dejó el ciclo anterior.
                let fill_fraction =
                    (consumer_in.slots() as f64 / 2.0) / capacity_frames.max(1) as f64;
                let now = Instant::now();
                let dt = now.duration_since(last_tick).as_secs_f64().max(1e-6);
                last_tick = now;

                let ratio_relative = controller.update(fill_fraction, dt);
                if let Err(e) = resampler.set_resample_ratio_relative(ratio_relative, true) {
                    log::warn!("No se pudo ajustar el ratio de resampleo: {e}");
                }

                // 2. Con el ratio ya actualizado, preguntar cuántos frames de entrada hacen
                //    falta para este bloque de salida de tamaño fijo.
                let needed_in_frames = resampler.input_frames_next();
                let needed_in_samples = needed_in_frames * 2;

                scratch_in.clear();
                while scratch_in.len() < needed_in_samples {
                    match consumer_in.pop() {
                        Ok(sample) => scratch_in.push(sample),
                        Err(_) => {
                            if !running.load(Ordering::Relaxed) {
                                return consumer_in;
                            }
                            // Espera corta: el hilo de entrada todavía no produjo suficientes
                            // muestras. No es el callback de audio — bloquear brevemente aquí
                            // es seguro.
                            std::thread::sleep(Duration::from_micros(500));
                        }
                    }
                }

                let input_adapter =
                    match InterleavedSlice::new(&scratch_in, 2, needed_in_frames) {
                        Ok(a) => a,
                        Err(e) => {
                            log::error!("Buffer de entrada inválido para el resampler: {e}");
                            continue;
                        }
                    };
                let mut output_adapter =
                    match InterleavedSlice::new_mut(&mut scratch_out, 2, OUTPUT_CHUNK_FRAMES) {
                        Ok(a) => a,
                        Err(e) => {
                            log::error!("Buffer de salida inválido para el resampler: {e}");
                            continue;
                        }
                    };

                match resampler.process_into_buffer(&input_adapter, &mut output_adapter, None) {
                    Ok((_frames_read, frames_written)) => {
                        for &sample in &scratch_out[..frames_written * 2] {
                            // Si el ring buffer de salida está lleno (el callback de salida no
                            // ha drenado a tiempo), se descarta el resto del bloque en vez de
                            // bloquear — el callback de salida ya cubre huecos con silencio.
                            if producer_out.push(sample).is_err() {
                                break;
                            }
                        }
                    }
                    Err(e) => log::warn!("Error resampleando: {e}"),
                }
            }

            consumer_in
        })
        .expect("no se pudo crear el hilo del resampler")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converge_hacia_cero_con_buffer_en_el_punto_medio() {
        let mut c = DriftController::new();
        let r = c.update(0.5, 0.01);
        assert!((r - 1.0).abs() < 1e-9, "sin error, no debe haber corrección: {r}");
    }

    #[test]
    fn buffer_demasiado_lleno_baja_el_ratio() {
        let mut c = DriftController::new();
        let r = c.update(0.9, 0.01);
        assert!(r < 1.0, "buffer lleno (>0.5) debe bajar el ratio, dio {r}");
    }

    #[test]
    fn buffer_demasiado_vacio_sube_el_ratio() {
        let mut c = DriftController::new();
        let r = c.update(0.1, 0.01);
        assert!(r > 1.0, "buffer vacío (<0.5) debe subir el ratio, dio {r}");
    }

    #[test]
    fn la_correccion_nunca_excede_el_limite_configurado() {
        let mut c = DriftController::with_gains(0.02, 0.002, 0.005);
        // Simular un desajuste de reloj sostenido y grande: el buffer se mantiene lleno
        // durante muchos ciclos, forzando al término integral a saturar.
        let mut last = 1.0;
        for _ in 0..10_000 {
            last = c.update(1.0, 0.01);
            assert!(
                (last - 1.0).abs() <= 0.005 + 1e-9,
                "la corrección se salió del límite ±0.5%: {last}"
            );
        }
        assert!(last < 1.0);
    }

    #[test]
    fn simula_50ppm_de_deriva_y_confirma_que_el_buffer_no_diverge() {
        // Réplica simplificada del escenario documentado: el reloj de entrada corre 50 ppm más
        // rápido que el de salida. Sin corrección, el buffer se llenaría sin límite. Con el
        // controlador activo, debe estabilizarse cerca del punto medio.
        let mut c = DriftController::new();
        let mut fill: f64 = 0.5;
        let dt = 0.01; // ciclos de 10 ms, como OUTPUT_CHUNK_FRAMES a 48 kHz
        let drift_per_tick = 0.00005; // 50 ppm expresado como fracción de buffer por ciclo

        for _ in 0..5_000 {
            let ratio_relative = c.update(fill, dt);
            // ratio_relative < 1.0 hace que el resampler consuma MÁS entrada por bloque de
            // salida de tamaño fijo (drena el buffer más rápido); > 1.0 consume menos (drena
            // más lento) — misma convención documentada en DriftController. El efecto de
            // drenaje es entonces proporcional a -(ratio_relative - 1.0).
            let drain_effect = -(ratio_relative - 1.0) * 4.0;
            fill += drift_per_tick - drain_effect;
            fill = fill.clamp(0.0, 1.0);
        }

        assert!(
            (fill - 0.5).abs() < 0.05,
            "el buffer debería estabilizarse cerca de 0.5, terminó en {fill}"
        );
    }
}
