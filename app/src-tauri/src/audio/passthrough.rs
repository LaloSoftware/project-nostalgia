//! El núcleo en tiempo real — ver docs/arquitectura/motor-de-audio.md.
//!
//! Reglas no negociables aquí dentro (CLAUDE.md): CERO asignaciones de memoria, CERO locks,
//! CERO I/O dentro de los callbacks de `cpal`. Ambos callbacks de este archivo cumplen eso:
//! copian muestras, hacen aritmética simple y empujan/sacan de ring buffers lock-free (`rtrb`).
//! Todo lo demás — resampleo (`drift.rs`), análisis (`analysis.rs`) — vive en hilos aparte.

use cpal::traits::DeviceTrait;
use cpal::{Sample as CpalSample, SampleFormat, StreamConfig};
use rtrb::{Consumer, Producer};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use super::testtone::TestTone;

/// ~200 ms de colchón entre los callbacks de hardware y los hilos de resampleo/análisis — ver
/// el diagrama en docs/arquitectura/motor-de-audio.md. Suficiente para absorber jitter del SO
/// sin añadir una latencia perceptible (ver docs/decisiones/0002-latencia-y-filtro-de-peine.md).
pub fn ring_capacity_frames(sample_rate: f32, seconds: f32) -> usize {
    (sample_rate * seconds) as usize
}

/// Controles compartidos entre el hilo de comandos y el callback de salida — todos átomos, sin
/// locks, para respetar la regla de arriba. La ganancia viaja como bits de un f32 porque no hay
/// `AtomicF32` en std.
pub struct OutputControls {
    pub gain_bits: Arc<AtomicU32>,
    pub muted: Arc<AtomicBool>,
    pub is_test_tone: Arc<AtomicBool>,
    pub underruns: Arc<AtomicU64>,
}

impl OutputControls {
    pub fn new(initial_gain_linear: f32) -> Self {
        Self {
            gain_bits: Arc::new(AtomicU32::new(initial_gain_linear.to_bits())),
            muted: Arc::new(AtomicBool::new(false)),
            is_test_tone: Arc::new(AtomicBool::new(false)),
            underruns: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn set_gain_linear(&self, gain: f32) {
        self.gain_bits.store(gain.to_bits(), Ordering::Relaxed);
    }
}

/// Construye el stream de entrada. Extrae únicamente los dos canales seleccionados
/// (`channel_pair`) de cada frame entrelazado y los empuja al ring buffer — ver
/// docs/arquitectura/dispositivos.md sobre el selector de par de canales.
pub fn build_input_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    channel_pair: (usize, usize),
    mut producer: Producer<f32>,
) -> Result<cpal::Stream, String> {
    let channels = config.channels as usize;
    let (ch_a, ch_b) = channel_pair;
    if ch_a.max(ch_b) >= channels {
        return Err(format!(
            "Par de canales {channel_pair:?} fuera de rango para un dispositivo de {channels} canal(es)"
        ));
    }

    let err_fn = |e| log::error!("Error en el stream de entrada: {e}");

    macro_rules! build_typed {
        ($t:ty) => {
            device.build_input_stream(
                config.clone(),
                move |data: &[$t], _: &cpal::InputCallbackInfo| {
                    let mut i = 0;
                    while i + channels <= data.len() {
                        let l: f32 = data[i + ch_a].to_sample();
                        let r: f32 = data[i + ch_b].to_sample();
                        // Sin bloquear: si está lleno, se pierde la muestra en vez de trabar el
                        // callback de hardware.
                        let _ = producer.push(l);
                        let _ = producer.push(r);
                        i += channels;
                    }
                },
                err_fn,
                None,
            )
        };
    }

    let stream = match sample_format {
        SampleFormat::F32 => build_typed!(f32),
        SampleFormat::I16 => build_typed!(i16),
        other => {
            return Err(format!(
                "Formato de muestra de entrada no soportado todavía: {other:?}"
            ))
        }
    }
    .map_err(super::describe_cpal_error)?;

    Ok(stream)
}

/// Construye el stream de salida: mezcla entrada resampleada o tono de prueba, aplica
/// ganancia/mute, escribe al hardware, y deja una copia post-ganancia en `tap_producer` para el
/// hilo de análisis (`analysis.rs`).
pub fn build_output_stream(
    device: &cpal::Device,
    config: &StreamConfig,
    sample_format: SampleFormat,
    mut consumer: Consumer<f32>,
    mut tap_producer: Producer<f32>,
    controls: Arc<OutputControls>,
    sample_rate: f32,
) -> Result<cpal::Stream, String> {
    let channels = config.channels as usize;
    let mut test_tone = TestTone::new(sample_rate);
    let err_fn = |e| log::error!("Error en el stream de salida: {e}");

    macro_rules! build_typed {
        ($t:ty) => {
            device.build_output_stream(
                config.clone(),
                move |data: &mut [$t], _: &cpal::OutputCallbackInfo| {
                    let muted = controls.muted.load(Ordering::Relaxed);
                    let gain = if muted {
                        0.0
                    } else {
                        f32::from_bits(controls.gain_bits.load(Ordering::Relaxed))
                    };
                    let use_test_tone = controls.is_test_tone.load(Ordering::Relaxed);

                    let mut i = 0;
                    while i + channels <= data.len() {
                        let (l, r) = if use_test_tone {
                            let s = test_tone.next_sample();
                            (s, s)
                        } else {
                            let l = match consumer.pop() {
                                Ok(v) => v,
                                Err(_) => {
                                    controls.underruns.fetch_add(1, Ordering::Relaxed);
                                    0.0
                                }
                            };
                            let r = consumer.pop().unwrap_or(0.0);
                            (l, r)
                        };

                        let out_l = l * gain;
                        let out_r = r * gain;

                        data[i] = out_l.to_sample();
                        if channels > 1 {
                            data[i + 1] = out_r.to_sample();
                        }
                        for slot in data.iter_mut().skip(i + 2).take(channels.saturating_sub(2)) {
                            *slot = CpalSample::EQUILIBRIUM;
                        }

                        // Tap de análisis: igual que arriba, se descarta en vez de bloquear.
                        let _ = tap_producer.push(out_l);
                        let _ = tap_producer.push(out_r);

                        i += channels;
                    }
                },
                err_fn,
                None,
            )
        };
    }

    let stream = match sample_format {
        SampleFormat::F32 => build_typed!(f32),
        SampleFormat::I16 => build_typed!(i16),
        other => {
            return Err(format!(
                "Formato de muestra de salida no soportado todavía: {other:?}"
            ))
        }
    }
    .map_err(super::describe_cpal_error)?;

    Ok(stream)
}
