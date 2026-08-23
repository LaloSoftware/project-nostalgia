# Despliegue Docker para pruebas en LAN (Etapa 1)

Sirve el build estático de Nostalgia (`pnpm build` → `app/dist`) por HTTP plano dentro de la red
local, para probar la app desde otros dispositivos sin instalar Node/pnpm/Tauri en ellos. Ver
`docs/decisiones/0011-servidor-docker-lan-para-pruebas-multidispositivo.md` para por qué existe
esto, qué se descartó y qué riesgos se aceptaron.

**No reemplaza el desarrollo diario.** `pnpm dev` local sigue siendo el flujo de todos los días;
esto es solo para "que alguien más lo vea desde su teléfono/laptop en la misma red".

## Levantar el contenedor

```sh
cd app/docker
docker compose up --build
```

Sirve en el puerto 8080 del host. Para cambiar el puerto, editar `ports:` en
`app/docker/docker-compose.yml`.

## Probar desde otro dispositivo de la LAN

1. Averiguar la IP del servidor en la LAN (ej. `192.168.1.50`).
2. Desde el dispositivo cliente, abrir Chrome con la bandera de origen inseguro. Es necesaria
   porque `getUserMedia` exige un "contexto seguro" y aquí es HTTP plano sobre IP, no
   localhost/HTTPS — ver el riesgo documentado en el ADR 0011.

   macOS/Linux:
   ```sh
   google-chrome --unsafely-treat-insecure-origin-as-secure=http://192.168.1.50:8080 --user-data-dir=/tmp/nostalgia-test
   ```

   Windows (cmd):
   ```
   chrome.exe --unsafely-treat-insecure-origin-as-secure=http://192.168.1.50:8080 --user-data-dir=C:\temp\nostalgia-test
   ```

   `--user-data-dir` con un perfil aparte evita aplicar esta bandera al perfil normal del
   navegador — no lo omitas.

3. Navegar a `http://192.168.1.50:8080` (sustituyendo la IP real) y aceptar el permiso de
   micrófono cuando lo pida.

## Reconstruir tras cambios

```sh
cd app/docker
docker compose up --build
```

No hay hot-reload distribuido a otros dispositivos (decisión deliberada, ver ADR 0011): cada
cambio que se quiera probar en otro dispositivo exige este comando manual.

## Etapa 2 (futura, no implementada)

HTTPS con CA local vía `tls internal` de Caddy, para eliminar la bandera insegura de Chrome. Ver
"Trabajo futuro" en `docs/decisiones/0011-servidor-docker-lan-para-pruebas-multidispositivo.md`.
