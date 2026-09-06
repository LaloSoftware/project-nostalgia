//! Superficie IPC — el único punto de contacto entre el frontend y `Engine`. Cada comando toma
//! el lock, hace una operación de control breve, y lo suelta; nunca toca los callbacks de audio
//! directamente (ver la nota de `state.rs`).
//!
//! `get_frame` se invoca por *polling* desde el bucle de `rAF` del frontend, no por eventos —
//! ver docs/decisiones/0006-polling-en-raf-vs-eventos.md: con la ventana cerrada, nadie llama a
//! `get_frame` y el tráfico IPC es exactamente cero.
//!
//! Nota sobre `.lock().unwrap()`: un lock envenenado (un pánico previo mientras alguien lo tenía
//! tomado) haría panicar también estas llamadas. Se acepta esa dureza a propósito: un panic
//! dentro de `Engine` es un bug real que hay que ver, no algo que valga la pena esconder con un
//! `unwrap_or_default()` silencioso.

use crate::audio::{AudioDeviceInfo, AudioFrame, EngineState, Source};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_input_devices(state: State<AppState>) -> Result<Vec<AudioDeviceInfo>, String> {
    state.engine.lock().unwrap().list_input_devices()
}

#[tauri::command]
pub fn get_input_channel_count(state: State<AppState>) -> u16 {
    state.engine.lock().unwrap().get_input_channel_count()
}

#[tauri::command]
pub fn start_engine(
    state: State<AppState>,
    device_id: String,
    channel_pair: Option<(u16, u16)>,
) -> Result<(), String> {
    state.engine.lock().unwrap().start(&device_id, channel_pair)
}

#[tauri::command]
pub fn stop_engine(state: State<AppState>) {
    state.engine.lock().unwrap().stop();
}

#[tauri::command]
pub fn set_source(state: State<AppState>, source: Source) {
    state.engine.lock().unwrap().set_source(source);
}

#[tauri::command]
pub fn set_gain_db(state: State<AppState>, db: f32) {
    state.engine.lock().unwrap().set_gain_db(db);
}

#[tauri::command]
pub fn toggle_mute(state: State<AppState>) {
    state.engine.lock().unwrap().toggle_mute();
}

#[tauri::command]
pub fn get_engine_state(state: State<AppState>) -> EngineState {
    state.engine.lock().unwrap().get_state()
}

#[tauri::command]
pub fn get_frame(state: State<AppState>) -> AudioFrame {
    state.engine.lock().unwrap().get_frame()
}
