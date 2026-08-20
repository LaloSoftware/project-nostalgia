pub mod audio;
pub mod commands;
pub mod state;

use state::AppState;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconEvent;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const MAIN_WINDOW_LABEL: &str = "main";
const MENU_ID_SHOW: &str = "show";
const MENU_ID_MUTE: &str = "mute";
const MENU_ID_QUIT: &str = "quit";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            setup_tray_menu(app)?;
            spawn_output_device_watcher(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_input_devices,
            commands::get_input_channel_count,
            commands::start_engine,
            commands::stop_engine,
            commands::set_source,
            commands::set_gain_db,
            commands::toggle_mute,
            commands::get_engine_state,
            commands::get_frame,
        ])
        .build(tauri::generate_context!())
        .expect("error construyendo la aplicación Tauri")
        .run(handle_run_event);
}

/// Ver docs/decisiones/0005-bandeja-y-ventana-destruible.md — esta función es la que justifica
/// haber elegido Tauri sobre Electron: cerrar la ventana la destruye de verdad (el webview se
/// libera, ~20 MB en bandeja), y solo se impide que la APLICACIÓN completa termine cuando el
/// último webview desaparece. El motor de audio en `AppState` no se entera de nada de esto — es
/// ajeno por completo al ciclo de vida de cualquier ventana.
fn handle_run_event(app_handle: &tauri::AppHandle, event: RunEvent) {
    match event {
        RunEvent::ExitRequested { api, .. } => {
            api.prevent_exit();
        }
        RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. }
            if label == MAIN_WINDOW_LABEL =>
        {
            // En macOS, sin ventana visible la app no debe ocupar el Dock — ver el plan
            // original ("ActivationPolicy::Accessory para que no ocupe el Dock estando en
            // bandeja").
            #[cfg(target_os = "macos")]
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
            #[cfg(not(target_os = "macos"))]
            let _ = app_handle;
        }
        _ => {}
    }
}

fn setup_tray_menu(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, MENU_ID_SHOW, "Mostrar", true, None::<&str>)?;
    let mute_item = MenuItem::with_id(app, MENU_ID_MUTE, "Silenciar", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, MENU_ID_QUIT, "Salir", true, None::<&str>)?;

    let menu = Menu::new(app)?;
    menu.append_items(&[&show_item, &mute_item, &separator, &quit_item])?;

    // El tray icon en sí ya lo crea Tauri automáticamente a partir de `trayIcon` en
    // tauri.conf.json; aquí solo le enganchamos el menú y los manejadores de eventos.
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu))?;
        let handle_for_menu = app.handle().clone();
        tray.on_menu_event(move |_tray_app, event| {
            handle_tray_menu_event(&handle_for_menu, event.id().as_ref());
        });
        let handle_for_icon = app.handle().clone();
        tray.on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                show_main_window(&handle_for_icon);
            }
        });
    } else {
        log::warn!("No se encontró el tray icon 'main' — revisa trayIcon en tauri.conf.json");
    }

    Ok(())
}

fn handle_tray_menu_event(app_handle: &tauri::AppHandle, id: &str) {
    match id {
        MENU_ID_SHOW => show_main_window(app_handle),
        MENU_ID_MUTE => {
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.engine.lock().unwrap().toggle_mute();
            }
        }
        MENU_ID_QUIT => {
            // Aquí sí queremos salir de verdad — a diferencia de cerrar la ventana (ver
            // handle_run_event), esto se lleva por delante el AtomicBool que exit() usa
            // internamente para no disparar prevent_exit() otra vez.
            app_handle.exit(0);
        }
        _ => {}
    }
}

/// Reconstruye la ventana si fue destruida (ver docs/decisiones/0005), o solo la enfoca si ya
/// existe.
fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    #[cfg(target_os = "macos")]
    let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Regular);

    match WebviewWindowBuilder::new(app_handle, MAIN_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("Nostalgia")
        .inner_size(960.0, 680.0)
        .min_inner_size(640.0, 480.0)
        .build()
    {
        Ok(_) => {}
        Err(e) => log::error!("No se pudo reconstruir la ventana principal: {e}"),
    }
}

/// Ver docs/arquitectura/dispositivos.md: vigila la salida por defecto del sistema y reconstruye
/// solo el lado de salida del motor cuando cambia (audífonos, altavoz Bluetooth, etc.), sin
/// tocar la ventana ni el stream de entrada.
fn spawn_output_device_watcher(app_handle: tauri::AppHandle) {
    let running = Arc::new(AtomicBool::new(true));
    audio::devices::spawn_output_watcher(running, move || {
        if let Some(state) = app_handle.try_state::<AppState>() {
            state.engine.lock().unwrap().on_output_device_changed();
        }
    });
    // Vive mientras el proceso viva — no hay un punto natural de "detener la app pero seguir
    // corriendo" distinto de salir del proceso entero, así que no se guarda el JoinHandle.
}
