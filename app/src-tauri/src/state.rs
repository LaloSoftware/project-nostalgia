use crate::audio::Engine;
use std::sync::Mutex;

/// Estado compartido de la app, inyectado en cada comando vía `tauri::State`.
///
/// El motor vive detrás de un `Mutex` porque start()/stop()/set_gain_db() son operaciones de
/// control poco frecuentes — nunca compiten con los callbacks de audio en tiempo real, que no
/// tocan este lock (ver la regla de "cero locks en el callback" en CLAUDE.md y el comentario de
/// cabecera de audio/passthrough.rs). `cpal::Stream` es `Send` en todos los backends que cpal
/// soporta (lo garantiza en tiempo de compilación con `assert_stream_send!` o `unsafe impl`), lo
/// que es precisamente lo que permite que `Engine` viva dentro de este `Mutex` sin más.
pub struct AppState {
    pub engine: Mutex<Engine>,
}

impl AppState {
    pub fn new() -> Self {
        Self { engine: Mutex::new(Engine::new()) }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
