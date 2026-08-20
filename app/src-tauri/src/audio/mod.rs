//! Superficie pública del motor de audio — ver docs/arquitectura/motor-de-audio.md.
//!
//! `Engine` es la única pieza que `commands.rs` toca directamente. Todo lo específico de
//! tiempo real vive detrás de esta fachada, en los submódulos.

pub mod analysis;
pub mod devices;
pub mod drift;
pub mod passthrough;
pub mod testtone;

pub use analysis::AudioFrame;
pub use devices::AudioDeviceInfo;

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::StreamConfig;
use passthrough::OutputControls;
use rtrb::{Consumer, RingBuffer};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

pub const MIN_DB: f32 = -60.0;
pub const MAX_DB: f32 = 6.0;

/// Deserialize además de Serialize porque, a diferencia de EngineState/AudioFrame (que solo
/// viajan del motor al frontend), esta llega COMO ARGUMENTO en el comando `set_source` — ver
/// commands.rs.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Input,
    TestTone,
}

/// Espejo de EngineState en app/src/core/types.ts — mismos nombres de campo (camelCase vía
/// serde) para que el frontend no necesite mapear nada al cambiar de motor. Ver
/// docs/decisiones/0003-orden-frontend-primero.md.
///
/// Diferencia semántica entre motores a tener presente: `device` aquí es un `DeviceId` de cpal
/// serializado a texto (ver `devices.rs`), mientras que en engine-web.ts (Fase A) es el label
/// legible del track de MediaStream. Ninguna carátula muestra este campo directamente hoy —
/// el nombre visible siempre sale de `AudioDeviceInfo.label` en el selector del shell — así que
/// no es una discrepancia visible, pero conviene no asumir que `device` es texto para humanos.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    pub running: bool,
    pub device: Option<String>,
    pub channel_pair: Option<(u16, u16)>,
    pub gain_db: f32,
    pub muted: bool,
    pub sample_rate_in: u32,
    pub sample_rate_out: u32,
    pub latency_ms: f32,
    pub source: Source,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            running: false,
            device: None,
            channel_pair: None,
            gain_db: -6.0,
            muted: false,
            sample_rate_in: 0,
            sample_rate_out: 0,
            latency_ms: 0.0,
            source: Source::Input,
        }
    }
}

/// Traduce los errores de `cpal` a mensajes en español accionables, igual que `describeError()`
/// hace del lado de `main.ts` (Fase A) con las excepciones de `getUserMedia`. Antes de esto, el
/// frontend recibía el mensaje crudo de `cpal::Error` (en inglés, pensado para logs, no para
/// una persona) — ver `docs/guias/permisos-de-plataforma.md`, sección "Manejo del rechazo".
/// `ErrorKind` es `#[non_exhaustive]`, así que el resto cae al mensaje propio de cpal.
pub(crate) fn describe_cpal_error(err: cpal::Error) -> String {
    match err.kind() {
        cpal::ErrorKind::PermissionDenied => {
            "Permiso de micrófono/entrada de línea denegado. En macOS: Ajustes del Sistema → \
             Privacidad y Seguridad → Micrófono, autoriza esta app y vuelve a intentar. En \
             Windows: Configuración → Privacidad y seguridad → Micrófono."
                .to_string()
        }
        cpal::ErrorKind::DeviceNotAvailable => {
            "El dispositivo de entrada ya no está disponible — ¿sigue conectado?".to_string()
        }
        cpal::ErrorKind::HostUnavailable => {
            "El subsistema de audio del sistema no está disponible en este momento.".to_string()
        }
        cpal::ErrorKind::DeviceBusy => {
            "El dispositivo de entrada está en uso por otra aplicación.".to_string()
        }
        cpal::ErrorKind::UnsupportedConfig => {
            "Este dispositivo no soporta la configuración de audio requerida (formato, canales \
             o tasa de muestreo)."
                .to_string()
        }
        _ => format!("No se pudo iniciar la entrada de audio: {err}"),
    }
}

fn db_to_linear(db: f32) -> f32 {
    if db <= MIN_DB {
        0.0
    } else {
        10f32.powf(db / 20.0)
    }
}

/// Handles que hay que mantener vivos mientras el motor está corriendo. Al soltarlos (Stream se
/// destruye en Drop) los callbacks de cpal dejan de invocarse.
struct RunningSession {
    input_stream: cpal::Stream,
    output_stream: cpal::Stream,
    controls: Arc<OutputControls>,
    threads_running: Arc<AtomicBool>,
    resampler_handle: JoinHandle<Consumer<f32>>,
    analysis_handle: JoinHandle<()>,
}

pub struct Engine {
    state: EngineState,
    session: Option<RunningSession>,
    shared_frame: Arc<Mutex<AudioFrame>>,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            state: EngineState::default(),
            session: None,
            shared_frame: Arc::new(Mutex::new(AudioFrame::default())),
        }
    }

    pub fn list_input_devices(&self) -> Vec<AudioDeviceInfo> {
        devices::list_input_devices()
    }

    pub fn get_state(&self) -> EngineState {
        self.state.clone()
    }

    pub fn get_frame(&self) -> AudioFrame {
        self.shared_frame.lock().map(|f| f.clone()).unwrap_or_default()
    }

    pub fn get_input_channel_count(&self) -> u16 {
        match &self.state.device {
            Some(id) => devices::find_input_device(id)
                .and_then(|d| d.default_input_config().ok())
                .map(|c| c.channels())
                .unwrap_or(2),
            None => 2,
        }
    }

    pub fn set_gain_db(&mut self, db: f32) {
        let db = db.clamp(MIN_DB, MAX_DB);
        self.state.gain_db = db;
        if let Some(s) = &self.session {
            s.controls.set_gain_linear(db_to_linear(db));
        }
    }

    pub fn toggle_mute(&mut self) {
        self.state.muted = !self.state.muted;
        if let Some(s) = &self.session {
            s.controls.muted.store(self.state.muted, Ordering::Relaxed);
        }
    }

    pub fn set_source(&mut self, source: Source) {
        self.state.source = source;
        if let Some(s) = &self.session {
            s.controls
                .is_test_tone
                .store(source == Source::TestTone, Ordering::Relaxed);
        }
    }

    /// Arranca (o reinicia por completo) el motor con el dispositivo de entrada dado.
    pub fn start(&mut self, device_id: &str, channel_pair: Option<(u16, u16)>) -> Result<(), String> {
        self.stop();

        let input_device = devices::find_input_device(device_id)
            .ok_or_else(|| format!("No se encontró el dispositivo de entrada '{device_id}'"))?;
        let output_device = devices::default_output_device()
            .ok_or_else(|| "No hay dispositivo de salida por defecto".to_string())?;

        let input_supported = input_device.default_input_config().map_err(describe_cpal_error)?;
        let output_supported = output_device.default_output_config().map_err(describe_cpal_error)?;

        let input_channels = input_supported.channels();
        let pair = resolve_channel_pair(channel_pair, input_channels);

        let sample_rate_in = input_supported.sample_rate() as f32;
        let sample_rate_out = output_supported.sample_rate() as f32;
        let input_config: StreamConfig = input_supported.clone().into();
        let output_config: StreamConfig = output_supported.clone().into();

        // Ring buffer A: entrada cruda -> hilo de resampleo. ~200 ms de colchón — ver
        // docs/arquitectura/motor-de-audio.md.
        let cap_a = passthrough::ring_capacity_frames(sample_rate_in, 0.2) * 2;
        let (producer_a, consumer_a) = RingBuffer::<f32>::new(cap_a.max(64));

        let controls = Arc::new(OutputControls::new(db_to_linear(self.state.gain_db)));
        controls.muted.store(self.state.muted, Ordering::Relaxed);
        controls
            .is_test_tone
            .store(self.state.source == Source::TestTone, Ordering::Relaxed);

        let input_stream = passthrough::build_input_stream(
            &input_device,
            &input_config,
            input_supported.sample_format(),
            pair,
            producer_a,
        )?;

        let threads_running = Arc::new(AtomicBool::new(true));
        let (output_stream, resampler_handle, analysis_handle) = build_output_session(
            &output_device,
            &output_config,
            output_supported.sample_format(),
            consumer_a,
            sample_rate_in,
            sample_rate_out,
            controls.clone(),
            threads_running.clone(),
            self.shared_frame.clone(),
        )?;

        input_stream.play().map_err(describe_cpal_error)?;
        output_stream.play().map_err(describe_cpal_error)?;

        let latency_ms = estimate_latency_ms(sample_rate_in, sample_rate_out);

        self.session = Some(RunningSession {
            input_stream,
            output_stream,
            controls,
            threads_running,
            resampler_handle,
            analysis_handle,
        });

        self.state.running = true;
        self.state.device = Some(device_id.to_string());
        self.state.channel_pair =
            (input_channels > 2).then_some((pair.0 as u16, pair.1 as u16));
        self.state.sample_rate_in = sample_rate_in as u32;
        self.state.sample_rate_out = sample_rate_out as u32;
        self.state.latency_ms = latency_ms;

        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(session) = self.session.take() {
            session.threads_running.store(false, Ordering::Relaxed);
            // Los streams se sueltan (Drop) antes de esperar los hilos: así el resampler/
            // análisis no compiten por CPU con callbacks todavía activos mientras cierran.
            drop(session.input_stream);
            drop(session.output_stream);
            let _ = session.resampler_handle.join();
            let _ = session.analysis_handle.join();
        }
        self.state.running = false;
    }

    /// Reconstruye SOLO el lado de salida cuando cambia el dispositivo de salida por defecto
    /// del sistema — ver docs/arquitectura/dispositivos.md. El stream de entrada, su ring
    /// buffer y el hilo de resampleo NO se tocan; se recupera `consumer_a` uniéndose al hilo de
    /// resampleo viejo (ver el comentario en `drift::spawn_resampler_thread`) y se le entrega
    /// al nuevo, así la sesión de entrada nunca se corta.
    pub fn on_output_device_changed(&mut self) {
        let Some(session) = self.session.take() else { return };

        match rebuild_output_session(session, self.state.sample_rate_in as f32, self.shared_frame.clone()) {
            Ok((new_session, sample_rate_out)) => {
                self.state.sample_rate_out = sample_rate_out as u32;
                self.state.latency_ms =
                    estimate_latency_ms(self.state.sample_rate_in as f32, sample_rate_out);
                self.session = Some(new_session);
            }
            Err(e) => {
                log::error!("No se pudo reconstruir la salida tras el cambio de dispositivo: {e}");
                // rebuild_output_session ya detuvo y unió los hilos viejos antes de fallar (ver
                // su propio comentario) — no hay fuga, pero tampoco sesión nueva. Se reporta
                // detenido en vez de fingir que sigue sonando.
                self.state.running = false;
            }
        }
    }
}

/// Consume la sesión vieja por valor a propósito: eso permite mover sus campos libremente (unir
/// los hilos, soltar el stream de salida) sin pelear con el borrow checker por hacerlo a través
/// de una referencia. Se detienen y unen el resampler/análisis viejos INCONDICIONALMENTE, antes
/// de intentar nada más — así nunca se filtra un hilo aunque la reconstrucción falle después.
fn rebuild_output_session(
    session: RunningSession,
    sample_rate_in: f32,
    shared_frame: Arc<Mutex<AudioFrame>>,
) -> Result<(RunningSession, f32), String> {
    session.threads_running.store(false, Ordering::Relaxed);
    let consumer_a = session
        .resampler_handle
        .join()
        .map_err(|_| "el hilo de resampleo anterior terminó con panic".to_string())?;
    let _ = session.analysis_handle.join();
    drop(session.output_stream); // session.input_stream NO se toca — sigue sonando durante todo esto

    let output_device = devices::default_output_device()
        .ok_or_else(|| "No hay dispositivo de salida por defecto".to_string())?;
    let output_supported = output_device.default_output_config().map_err(describe_cpal_error)?;
    let output_config: StreamConfig = output_supported.clone().into();
    let sample_rate_out = output_supported.sample_rate() as f32;

    let new_threads_running = Arc::new(AtomicBool::new(true));
    let (output_stream, resampler_handle, analysis_handle) = build_output_session(
        &output_device,
        &output_config,
        output_supported.sample_format(),
        consumer_a,
        sample_rate_in,
        sample_rate_out,
        session.controls.clone(),
        new_threads_running.clone(),
        shared_frame,
    )?;
    output_stream.play().map_err(describe_cpal_error)?;

    Ok((
        RunningSession {
            input_stream: session.input_stream,
            output_stream,
            controls: session.controls,
            threads_running: new_threads_running,
            resampler_handle,
            analysis_handle,
        },
        sample_rate_out,
    ))
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

fn resolve_channel_pair(requested: Option<(u16, u16)>, input_channels: u16) -> (usize, usize) {
    match requested {
        Some((a, b)) if a < input_channels && b < input_channels => (a as usize, b as usize),
        _ if input_channels >= 2 => (0, 1),
        _ => (0, 0), // dispositivo mono: L y R leen el mismo canal
    }
}

fn estimate_latency_ms(sample_rate_in: f32, sample_rate_out: f32) -> f32 {
    // Peor caso: el colchón combinado de los ring buffers A (entrada, 200ms) y B (resampleada,
    // 200ms) — ver docs/decisiones/0002-latencia-y-filtro-de-peine.md. No incluye la latencia
    // propia del driver/dispositivo, que cpal no expone de forma uniforme entre plataformas.
    let _ = sample_rate_in; // reservado: si A y B usaran tamaños distintos por tasa, entraría aquí
    let cap_b_frames = passthrough::ring_capacity_frames(sample_rate_out, 0.2);
    (cap_b_frames as f32 / sample_rate_out) * 1000.0 * 2.0
}

#[allow(clippy::too_many_arguments)]
fn build_output_session(
    output_device: &cpal::Device,
    output_config: &StreamConfig,
    output_sample_format: cpal::SampleFormat,
    consumer_a: Consumer<f32>,
    sample_rate_in: f32,
    sample_rate_out: f32,
    controls: Arc<OutputControls>,
    threads_running: Arc<AtomicBool>,
    shared_frame: Arc<Mutex<AudioFrame>>,
) -> Result<(cpal::Stream, JoinHandle<Consumer<f32>>, JoinHandle<()>), String> {
    // Ring buffer B: ya resampleada -> callback de salida.
    let cap_b = passthrough::ring_capacity_frames(sample_rate_out, 0.2) * 2;
    let (producer_b, consumer_b) = RingBuffer::<f32>::new(cap_b.max(64));

    // Ring buffer C: tap de análisis (post-ganancia) — más chico, no necesita colchón grande.
    let cap_c = passthrough::ring_capacity_frames(sample_rate_out, 0.1) * 2;
    let (producer_c, consumer_c) = RingBuffer::<f32>::new(cap_c.max(64));

    let output_stream = passthrough::build_output_stream(
        output_device,
        output_config,
        output_sample_format,
        consumer_b,
        producer_c,
        controls,
        sample_rate_out,
    )?;

    let resampler_handle = drift::spawn_resampler_thread(
        consumer_a,
        producer_b,
        sample_rate_in,
        sample_rate_out,
        threads_running.clone(),
    );
    let analysis_handle =
        analysis::spawn_analysis_thread(consumer_c, sample_rate_out, shared_frame, threads_running);

    Ok((output_stream, resampler_handle, analysis_handle))
}
