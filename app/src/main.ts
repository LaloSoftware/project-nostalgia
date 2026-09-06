import "./styles/base.css";

import { isTauri } from "@tauri-apps/api/core";
import { WebAudioEngine } from "./core/engine-web";
import type { AudioDeviceInfo, AudioEngine } from "./core/engine";
import type { AudioSource, Skin, SkinHostApi } from "./core/types";
import { loadSettings, saveSettings } from "./core/settings";
import { Shell } from "./ui/shell";
import { registerSkin, getSkin, listSkins } from "./skins/registry";

import { manifest as consoleDigitalManifest } from "./skins/console-digital/manifest";
import { createSkin as createConsoleDigital } from "./skins/console-digital/skin";
import { manifest as woodHifiManifest } from "./skins/wood-hifi/manifest";
import { createSkin as createWoodHifi } from "./skins/wood-hifi/skin";
import { manifest as milkdropManifest } from "./skins/milkdrop/manifest";

// Orquestador de ambas fases: registra las carátulas, arma el shell, conecta el motor de audio
// activo y arranca el bucle de dibujo. Ver docs/arquitectura/vision-general.md — este archivo es
// la única pieza que decide qué motor concreto usar; todo lo demás (shell, carátulas) programa
// contra las interfaces de core/, nunca contra engine-web.ts/engine-tauri.ts directamente.
//
// isTauri() detecta en runtime si la app corre dentro del shell de Tauri (Fase B) o en un
// navegador normal (Fase A) — el mismo build sirve ambos casos sin flags de compilación. La
// carga de engine-tauri.ts es diferida (import() dinámico): así el bundle de la Fase A no
// arrastra el cliente de @tauri-apps/api cuando ni siquiera hay un backend Tauri escuchando.
async function createEngine(): Promise<AudioEngine> {
  if (isTauri()) {
    const { TauriAudioEngine } = await import("./core/engine-tauri");
    return new TauriAudioEngine();
  }
  return new WebAudioEngine();
}

registerSkin({ manifest: consoleDigitalManifest, createSkin: createConsoleDigital });
registerSkin({ manifest: woodHifiManifest, createSkin: createWoodHifi });
registerSkin({
  manifest: milkdropManifest,
  // import() dinámico: butterchurn + butterchurn-presets (~900 KB) solo se descargan si el
  // usuario de verdad selecciona esta carátula, no en el bundle principal.
  createSkin: () => import("./skins/milkdrop/skin").then((m) => m.createSkin()),
});

const settings = loadSettings();
// Se asigna al inicio de init(), antes de que nada pueda invocar los closures de más abajo que
// la usan (hostApi, los callbacks del Shell, frameLoop) — ver createEngine().
let engine: AudioEngine;

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("Falta #app en index.html");

let currentSkin: Skin | null = null;

const hostApi: SkinHostApi = {
  setGainDb(db) {
    engine.setGainDb(db);
    settings.gainDb = engine.getState().gainDb;
    saveSettings(settings);
  },
  toggleMute() {
    engine.toggleMute();
  },
  selectDevice(deviceName, channelPair) {
    void handleSelectDevice(deviceName, channelPair);
  },
  setSource(source: AudioSource) {
    engine.setSource(source);
  },
  openSettings() {
    shell.openSettings();
  },
  getWebAudioNode() {
    return engine.getWebAudioNode?.() ?? null;
  },
};

const shell = new Shell(appRoot, {
  onSelectSkin(id) {
    void mountSkin(id);
  },
  onSelectDevice(deviceId) {
    void handleSelectDevice(deviceId);
  },
  onSelectChannelPair(pair) {
    void handleSelectDevice(settings.deviceId ?? "", pair);
  },
  onSelectSource(source) {
    engine.setSource(source);
  },
});

// Token de carga: si el usuario cambia de carátula mientras un import() dinámico (MilkDrop)
// todavía está en curso, la carga vieja se descarta al llegar en vez de montarse por encima de
// la nueva selección.
let mountToken = 0;

async function mountSkin(id: string): Promise<void> {
  const mod = getSkin(id) ?? listSkins().map((m) => getSkin(m.id)!).find(Boolean);
  if (!mod) throw new Error("No hay carátulas registradas");

  const token = ++mountToken;
  const skin = await mod.createSkin();
  if (token !== mountToken) return; // se seleccionó otra carátula mientras esta cargaba

  currentSkin?.unmount();
  currentSkin = skin;
  currentSkin.mount(shell.stage, hostApi);

  settings.skinId = mod.manifest.id;
  saveSettings(settings);
  shell.setSkins(listSkins(), mod.manifest.id);
}

async function handleSelectDevice(
  deviceId: string,
  channelPair?: [number, number],
): Promise<void> {
  if (!deviceId) return;
  try {
    await engine.start(deviceId, channelPair);
    shell.showError(null);

    settings.deviceId = deviceId;
    settings.channelPair = channelPair ?? null;
    saveSettings(settings);

    const channelCount = engine.getInputChannelCount();
    if (channelCount > 2) {
      const pairs: [number, number][] = [];
      for (let i = 0; i + 1 < channelCount; i += 2) pairs.push([i, i + 1]);
      shell.setChannelPairOptions(pairs);
    } else {
      shell.setChannelPairOptions(null);
    }
  } catch (err) {
    shell.showError(describeError(err));
  }
}

function describeError(err: unknown): string {
  // Fase A: getUserMedia rechaza con DOMException (permiso de micrófono, dispositivo ausente).
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
        return "Permiso de micrófono denegado. Autorízalo en los ajustes del navegador/sistema y vuelve a intentar.";
      case "NotFoundError":
        return "No se encontró el dispositivo de entrada. ¿Sigue conectado?";
    }
  }
  // Fase B: los comandos Tauri rechazan con el String que devuelve Engine::start en Rust — ya
  // viene en español y describe la causa concreta (ver src-tauri/src/audio/mod.rs), así que se
  // muestra tal cual en vez de genérico.
  if (typeof err === "string" && err.length > 0) return err;
  return "No se pudo iniciar la entrada de audio. Revisa la conexión del dispositivo.";
}

async function init(): Promise<void> {
  engine = await createEngine();

  const skins = listSkins();
  const initialSkinId = getSkin(settings.skinId) ? settings.skinId : skins[0].id;
  await mountSkin(initialSkinId);

  // No se deja que un fallo aquí tumbe init() entero (nunca llegaría a requestAnimationFrame más
  // abajo, dejando la UI congelada sin bucle de dibujo). En Fase B esto puede rechazar de verdad
  // ahora que devices::list_input_devices() (src-tauri/src/audio/devices.rs) propaga el error de
  // `cpal` en vez de tragárselo como lista vacía — ver el hallazgo de Windows documentado ahí.
  let devices: AudioDeviceInfo[] = [];
  try {
    devices = await engine.listInputDevices();
  } catch (err) {
    console.error("listInputDevices falló:", err);
    shell.showError(describeError(err));
  }
  shell.setDevices(devices, settings.deviceId);

  if (settings.gainDb !== undefined) engine.setGainDb(settings.gainDb);

  // Auto-arranque best-effort si había un dispositivo recordado de la sesión anterior; si el
  // permiso ya no es válido, handleSelectDevice() lo reporta en el banner de error en vez de
  // fallar en silencio.
  const remembered = settings.deviceId && devices.find((d) => d.id === settings.deviceId);
  if (remembered) {
    await handleSelectDevice(remembered.id, settings.channelPair ?? undefined);
  }

  requestAnimationFrame(frameLoop);
}

function frameLoop(): void {
  currentSkin?.render(engine.getFrame(), engine.getState());
  requestAnimationFrame(frameLoop);
}

init().catch((err) => {
  console.error("Error inicializando Nostalgia:", err);
  shell.showError("Error inicializando la aplicación. Revisa la consola.");
});
