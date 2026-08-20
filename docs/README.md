# Documentación de Nostalgia

Este directorio documenta el **proceso, las decisiones y la arquitectura** del proyecto — no es
un manual de usuario. Vive separado de `app/` a propósito (ver `CLAUDE.md` en la raíz): el
objetivo es que alguien pueda entender por qué el proyecto es como es sin abrir una sola línea de
código.

## Cómo navegar

- **`BITACORA.md`** — registro cronológico de sesiones de trabajo: qué se hizo, qué se decidió,
  qué quedó pendiente.
- **`decisiones/`** — ADRs (Architecture Decision Records). Cada decisión técnica con impacto
  arquitectónico, numerada, con alternativas consideradas, números concretos y costos aceptados.
  Es la fuente de verdad sobre **por qué** el proyecto tomó cada camino. Empezar por el
  ADR 0001 si es la primera vez que se lee este proyecto.
- **`arquitectura/`** — cómo está construido el sistema una vez tomadas las decisiones: el
  contrato de datos entre motor y carátulas, el motor de audio, la corrección de deriva de reloj,
  el manejo de dispositivos.
- **`guias/`** — instrucciones prácticas: cómo crear una carátula nueva, cómo compilar y empaquetar
  los instaladores, cómo resolver los permisos de plataforma (micrófono en macOS/Windows).
- **`hardware/`** — contexto sobre el equipo real del usuario (tocadiscos, tarjeta de audio,
  montaje RCA/USB) que motiva varias decisiones de diseño.
- **`ROADMAP.md`** — qué queda fuera de la v1 y por qué, con la justificación de cada iteración
  futura.

## Índice de ADRs

| # | Título | Estado |
|---|---|---|
| [0001](decisiones/0001-stack-tauri-vs-electron.md) | Stack: Tauri v2 + Rust, no Electron | aceptada |
| [0002](decisiones/0002-latencia-y-filtro-de-peine.md) | Presupuesto de latencia y filtro de peine | aceptada |
| [0003](decisiones/0003-orden-frontend-primero.md) | Orden: frontend con Web Audio primero | aceptada |
| [0004](decisiones/0004-alcance-v1.md) | Alcance de la v1 | aceptada |
| [0005](decisiones/0005-bandeja-y-ventana-destruible.md) | Bandeja del sistema con ventana destruible | aceptada |
| [0006](decisiones/0006-polling-en-raf-vs-eventos.md) | Polling en `rAF` vs eventos Rust→JS | aceptada |
| [0007](decisiones/0007-dependencias-y-cadena-de-suministro.md) | Dependencias del frontend y cadena de suministro (pnpm) | aceptada |
| [0008](decisiones/0008-hilo-dedicado-de-resampleo.md) | Resampleo en un hilo dedicado, no en el callback de salida | aceptada |
