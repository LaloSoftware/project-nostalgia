import type { SkinManifest } from "../core/types";
import type { AudioDeviceInfo } from "../core/engine";
import "./shell.css";

// El shell es cromo funcional alrededor de la carátula activa: barra de carátulas, panel de
// ajustes (dispositivo, par de canales, fuente). Es la única parte de la UI que usa iconos
// modernos de trazo (lucide + morphicons) — una carátula como el Hi-Fi de madera puede optar por
// no tocarlos, ver docs/dependencias del frontend en ADR 0007.

// Nota: ganancia y mute NO pasan por el shell — son intenciones que cada carátula emite
// directamente vía SkinHostApi (ver core/types.ts), porque la perilla y el botón de mute son
// parte del diseño de cada carátula, no del cromo compartido.
export interface ShellCallbacks {
  onSelectSkin(id: string): void;
  onSelectDevice(deviceId: string): void;
  onSelectChannelPair(pair: [number, number]): void;
  onSelectSource(source: "input" | "testTone"): void;
}

export class Shell {
  readonly stage: HTMLElement;
  private skinBar: HTMLElement;
  private settingsPanel: HTMLElement;
  private deviceSelect: HTMLSelectElement;
  private channelPairRow: HTMLElement;
  private channelPairSelect: HTMLSelectElement;
  private errorBanner: HTMLElement;
  private cb: ShellCallbacks;

  constructor(root: HTMLElement, cb: ShellCallbacks) {
    this.cb = cb;
    root.innerHTML = "";

    const header = document.createElement("header");
    header.className = "shell-bar";

    this.skinBar = document.createElement("div");
    this.skinBar.className = "shell-skins";
    header.appendChild(this.skinBar);

    const settingsToggle = document.createElement("button");
    settingsToggle.className = "shell-settings-toggle";
    settingsToggle.type = "button";
    settingsToggle.textContent = "⚙ Ajustes";
    settingsToggle.addEventListener("click", () => {
      this.settingsPanel.toggleAttribute("hidden");
    });
    header.appendChild(settingsToggle);

    this.errorBanner = document.createElement("div");
    this.errorBanner.className = "shell-error";
    this.errorBanner.hidden = true;

    this.stage = document.createElement("main");
    this.stage.className = "shell-stage";

    this.settingsPanel = document.createElement("aside");
    this.settingsPanel.className = "shell-settings";
    this.settingsPanel.hidden = true;

    const deviceLabel = document.createElement("label");
    deviceLabel.textContent = "Entrada";
    this.deviceSelect = document.createElement("select");
    this.deviceSelect.addEventListener("change", () => {
      this.cb.onSelectDevice(this.deviceSelect.value);
    });
    deviceLabel.appendChild(this.deviceSelect);

    this.channelPairRow = document.createElement("label");
    this.channelPairRow.textContent = "Par de canales";
    this.channelPairSelect = document.createElement("select");
    this.channelPairSelect.addEventListener("change", () => {
      const [a, b] = this.channelPairSelect.value.split("-").map(Number);
      this.cb.onSelectChannelPair([a, b]);
    });
    this.channelPairRow.appendChild(this.channelPairSelect);
    this.channelPairRow.hidden = true; // solo visible si el dispositivo tiene > 2 canales

    const sourceLabel = document.createElement("label");
    sourceLabel.textContent = "Fuente";
    const sourceSelect = document.createElement("select");
    for (const [value, text] of [
      ["input", "Entrada real"],
      ["testTone", "Tono de prueba"],
    ] as const) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      sourceSelect.appendChild(opt);
    }
    sourceSelect.addEventListener("change", () => {
      this.cb.onSelectSource(sourceSelect.value as "input" | "testTone");
    });
    sourceLabel.appendChild(sourceSelect);

    this.settingsPanel.append(deviceLabel, this.channelPairRow, sourceLabel);

    root.append(header, this.errorBanner, this.stage, this.settingsPanel);
  }

  setSkins(manifests: SkinManifest[], activeId: string): void {
    this.skinBar.innerHTML = "";
    for (const m of manifests) {
      const btn = document.createElement("button");
      btn.className = "shell-skin-btn";
      btn.type = "button";
      btn.textContent = m.name;
      btn.setAttribute("aria-pressed", String(m.id === activeId));
      btn.addEventListener("click", () => this.cb.onSelectSkin(m.id));
      this.skinBar.appendChild(btn);
    }
  }

  setDevices(devices: AudioDeviceInfo[], selectedId: string | null): void {
    this.deviceSelect.innerHTML = "";
    for (const d of devices) {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.label;
      if (d.id === selectedId) opt.selected = true;
      this.deviceSelect.appendChild(opt);
    }
  }

  /** Se muestra únicamente cuando el dispositivo activo expone más de 2 canales — ver
   *  docs/arquitectura/dispositivos.md. */
  setChannelPairOptions(pairs: [number, number][] | null): void {
    if (!pairs) {
      this.channelPairRow.hidden = true;
      return;
    }
    this.channelPairRow.hidden = false;
    this.channelPairSelect.innerHTML = "";
    for (const [a, b] of pairs) {
      const opt = document.createElement("option");
      opt.value = `${a}-${b}`;
      opt.textContent = `Canales ${a + 1}–${b + 1}`;
      this.channelPairSelect.appendChild(opt);
    }
  }

  /** Usado por SkinHostApi.openSettings() — ver core/types.ts. Abre el panel; no lo cierra si
   *  ya estaba abierto (a diferencia del botón de la barra, que alterna). */
  openSettings(): void {
    this.settingsPanel.hidden = false;
  }

  showError(message: string | null): void {
    this.errorBanner.hidden = message === null;
    this.errorBanner.textContent = message ?? "";
  }
}
