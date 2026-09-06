//! Enumeración y seguimiento de dispositivos — ver docs/arquitectura/dispositivos.md.
//!
//! `cpal` no ofrece un callback de "cambió el dispositivo por defecto" ni de "se
//! conectó/desconectó algo": hay que construirlo a mano. Este módulo hace dos cosas:
//! listar dispositivos de entrada (para el selector de la UI) y vigilar cambios de la salida
//! por defecto del sistema en un hilo aparte.
//!
//! **Nota de refinamiento sobre Fase B:** la documentación de arquitectura original asumía que
//! cpal no da IDs estables entre reconexiones (cierto en versiones anteriores del crate) y
//! diseñaba la persistencia por nombre con coincidencia por prefijo. La versión de cpal
//! realmente instalada (0.18.1) sí expone un `DeviceId` documentado como estable "across
//! program runs, device disconnections, and system reboots where possible" — se usa como
//! identificador primario aquí, con el nombre visible como respaldo si el ID guardado alguna
//! vez no resuelve (p. ej. tras cambiar de plataforma). El texto de
//! docs/arquitectura/dispositivos.md se actualiza junto con este archivo.

use super::describe_cpal_error;
use cpal::traits::{DeviceTrait, HostTrait};
use cpal::DeviceId;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    /// `DeviceId` serializado a texto (ver `DeviceId: Display + FromStr`) — no un nombre.
    pub id: String,
    pub label: String,
    pub channel_count: u16,
}

/// Antes, un `host.input_devices()` fallido se tragaba en silencio devolviendo `Vec::new()`: la
/// UI simplemente mostraba un selector vacío, sin ninguna pista de si el sistema no tenía
/// dispositivos o si `cpal`/WASAPI (en Windows) falló al enumerarlos — un error real reportado en
/// Windows resultó irrastreable por esto exacto. Ahora se loguea la causa (visible en la consola
/// de Tauri en build de debug — ver `lib.rs`) y se propaga como `Result` hasta el comando IPC
/// (`commands.rs`), reutilizando `describe_cpal_error` para el mismo texto accionable en español
/// que ya usa `Engine::start()`.
pub fn list_input_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let devices = host.input_devices().map_err(|err| {
        log::error!("cpal: fallo enumerando dispositivos de entrada: {err}");
        describe_cpal_error(err)
    })?;

    Ok(devices
        .filter_map(|device| {
            let id = match device.id() {
                Ok(id) => id.to_string(),
                Err(err) => {
                    // Un dispositivo individual con id ilegible no debe tumbar la lista entera —
                    // se omite ese dispositivo, pero se deja rastro de por qué desapareció.
                    log::warn!("cpal: no se pudo leer el id de un dispositivo de entrada: {err}");
                    return None;
                }
            };
            let label = device.to_string(); // DeviceTrait: Display — el nombre visible
            let channel_count = device
                .default_input_config()
                .map(|c| c.channels())
                .unwrap_or(2);
            Some(AudioDeviceInfo { id, label, channel_count })
        })
        .collect())
}

/// Busca un dispositivo de entrada por el `id` persistido. Primero intenta resolverlo como
/// `DeviceId` real (el caso normal); si no resuelve, cae a comparar contra el nombre visible —
/// ver la nota de refinamiento al inicio del archivo.
pub fn find_input_device(id_str: &str) -> Option<cpal::Device> {
    let host = cpal::default_host();

    if let Ok(id) = id_str.parse::<DeviceId>() {
        if let Some(device) = host.device_by_id(&id) {
            return Some(device);
        }
    }

    // A diferencia de list_input_devices() (arriba), esta ruta no puede devolver un `Result` sin
    // romper la firma que ya consumen mod.rs:155/191 (ambas tratan "no encontrado" como un caso
    // normal, no un error de sistema) — pero si la propia enumeración falla, vale la pena dejar
    // rastro de por qué, en vez de que ambos casos se vean idénticos desde afuera (`None`).
    let devices = match host.input_devices() {
        Ok(devices) => devices,
        Err(err) => {
            log::error!("cpal: fallo enumerando dispositivos de entrada al buscar '{id_str}': {err}");
            return None;
        }
    };
    devices.into_iter().find(|d| d.to_string() == id_str)
}

pub fn default_output_device() -> Option<cpal::Device> {
    cpal::default_host().default_output_device()
}

fn default_output_device_id() -> Option<DeviceId> {
    default_output_device().and_then(|d| d.id().ok())
}

/// Vigila la salida por defecto del sistema cada ~1.5 s y llama a `on_change` cuando cambia
/// (el caso diario: enchufar audífonos). No cubre la reconexión del dispositivo de ENTRADA tras
/// un desenchufe — eso lo detecta el callback de error del stream en `passthrough.rs`, que hoy
/// solo lo reporta (no reintenta solo). Ver docs/ROADMAP.md.
pub fn spawn_output_watcher<F>(running: Arc<AtomicBool>, on_change: F) -> JoinHandle<()>
where
    F: Fn() + Send + 'static,
{
    std::thread::Builder::new()
        .name("nostalgia-device-watcher".into())
        .spawn(move || {
            let mut last = default_output_device_id();
            while running.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(1500));
                if !running.load(Ordering::Relaxed) {
                    break;
                }
                let current = default_output_device_id();
                if current != last {
                    if current.is_some() {
                        on_change();
                    }
                    last = current;
                }
            }
        })
        .expect("no se pudo crear el hilo de vigilancia de dispositivos")
}
