# Despliegue Docker para pruebas en LAN (Etapa 2: HTTPS con CA local)

Sirve el build estático de Nostalgia (`pnpm build` → `app/dist`) por HTTPS dentro de la red local,
para probar la app desde otros dispositivos sin instalar Node/pnpm/Tauri en ellos. Ver
`docs/decisiones/0011-servidor-docker-lan-para-pruebas-multidispositivo.md` (por qué existe esto)
y `docs/decisiones/0012-https-con-ca-local-para-el-servidor-docker-lan.md` (por qué HTTPS con CA
local y no la bandera insegura de la Etapa 1) para el razonamiento completo.

**No reemplaza el desarrollo diario.** `pnpm dev` local sigue siendo el flujo de todos los días;
esto es solo para "que alguien más lo vea desde su teléfono/laptop en la misma red".

## 1. Configurar el host antes de la primera vez

```sh
cd app/docker
cp .env.example .env
```

Editar `.env` y poner la IP (o nombre) real del servidor en la LAN — ej. `192.168.1.50`. Este
valor tiene que coincidir **exactamente** con lo que vas a escribir en la barra de direcciones de
los dispositivos cliente: es el Subject Alternative Name del certificado que Caddy emite (ver ADR
0012). Si el servidor no tiene una IP reservada en el router (DHCP estático), confírmala de nuevo
tras cualquier reinicio del servidor antes de asumir que sigue siendo la misma.

## 2. Levantar el contenedor

```sh
cd app/docker
docker compose up --build
```

Sirve HTTPS en el puerto 443 del host (y una redirección automática desde el 80). Si alguno de los
dos puertos ya está en uso en el servidor, ajustar `ports:` en `app/docker/docker-compose.yml`.

## 3. Instalar la CA local en cada dispositivo cliente (una sola vez por dispositivo)

Extraer el certificado raíz que Caddy generó dentro del volumen persistente:

```sh
docker cp nostalgia-web:/data/caddy/pki/authorities/local/root.crt ./nostalgia-lan-ca.crt
```

Llevar `nostalgia-lan-ca.crt` a cada dispositivo cliente (USB, chat interno, correo) e instalarlo
como **CA raíz de confianza** — no como certificado de sitio individual:

- **Windows:** doble clic en el `.crt` → "Instalar certificado" → "Equipo local" → "Colocar todos
  los certificados en el siguiente almacén" → **Entidades de certificación raíz de confianza**.
- **macOS:** doble clic para abrir en Acceso a Llaveros → localizar el certificado en el llavero
  "Sistema" → panel de Confianza → "Al usar este certificado": **Confiar siempre**.
- **Android:** Ajustes → Seguridad → Cifrado y credenciales → Instalar un certificado → CA.
  Algunas versiones piden fijar un PIN/patrón de pantalla de bloqueo antes de permitirlo.
- **iOS:** enviar el archivo (AirDrop/correo) → Ajustes → Perfil descargado → Instalar → **además**
  ir a Ajustes → General → Información → Ajustes de confianza de certificados y activar la
  confianza total para esta CA (iOS lo exige como paso aparte).
- **Linux (Chrome/Chromium):** copiar a `/usr/local/share/ca-certificates/nostalgia-lan-ca.crt` y
  ejecutar `sudo update-ca-certificates` (Debian/Ubuntu) — Firefox usa su propio almacén, ver el
  siguiente punto si aplica.
- **Firefox** (cualquier plataforma): no usa el almacén del sistema operativo. Ajustes → Privacidad
  y Seguridad → Certificados → Ver certificados → Autoridades → Importar.

Este paso se repite solo si el volumen `caddy_data` se destruye (ver "Riesgos conocidos" en el ADR
0012) o si se instala en un dispositivo nuevo — no en cada sesión.

## 4. Probar desde otro dispositivo de la LAN

Navegar a `https://<ip-del-servidor>/` (sustituyendo por el mismo valor puesto en `.env`) y
aceptar el permiso de micrófono cuando lo pida. Ya no hace falta ninguna bandera especial de
Chrome — al ser HTTPS real (con una CA que el dispositivo ya marcó como confiable), es un
"contexto seguro" legítimo para `getUserMedia`.

## Reconstruir tras cambios de código

```sh
cd app/docker
docker compose up --build
```

No hay hot-reload distribuido a otros dispositivos (decisión deliberada, ver ADR 0011): cada
cambio que se quiera probar en otro dispositivo exige este comando manual. Este comando **no**
toca el volumen `caddy_data` — la CA y la confianza ya instalada en los clientes sobreviven.
Evitar `docker compose down -v` a menos que se quiera regenerar la CA a propósito (ver "Riesgos
conocidos" en el ADR 0012): invalida la confianza ya instalada en todos los dispositivos.

## Verificar que el servidor sirve TLS correctamente (sin instalar la CA todavía)

```sh
openssl s_client -connect <ip-o-host>:443 -servername <ip-o-host> </dev/null
```

`-servername` es obligatorio aquí — ver "Hallazgo real durante la verificación" en el ADR 0012:
`curl -k https://<ip>/` (al menos el `curl` de macOS, sobre LibreSSL) puede fallar con
`tlsv1 alert internal error` porque, correctamente según el RFC 6066, no manda la extensión SNI
cuando el destino es una IP literal — y Caddy, con un único sitio configurado para ese host exacto,
no tiene certificado que ofrecer sin SNI. Es una limitación de esa herramienta de línea de
comandos, **no del servidor** — los navegadores reales sí mandan SNI para IPs y no tienen este
problema (ver el ADR 0012 para el diagnóstico completo; no se pudo confirmar con un navegador real
en el entorno donde se escribió esta guía, queda pendiente de confirmar en un dispositivo real).

Para confirmar que la cadena de confianza completa funciona (simulando lo que un dispositivo
cliente ve después de instalar la CA del paso 3):

```sh
openssl s_client -connect <ip-o-host>:443 -servername <ip-o-host> -CAfile nostalgia-lan-ca.crt </dev/null 2>&1 | grep "Verify return"
# Verify return code: 0 (ok)  ← esto confirma que la CA extraída sí valida el certificado servido
```

## Verificación end-to-end de esta sesión (2026-08-29)

- `docker compose up --build` completado sin errores; logs de Caddy confirman
  `"enabling automatic HTTP->HTTPS redirects"` y `"certificate obtained successfully",
  "identifier":"192.168.1.64","issuer":"local"`.
- `curl -sI http://192.168.1.64/` → `308 Permanent Redirect` a `https://192.168.1.64/`.
- `openssl s_client -connect 192.168.1.64:443 -servername 192.168.1.64` → certificado servido con
  SAN `IP Address:192.168.1.64`, emisor `Caddy Local Authority - ECC Intermediate`.
- `docker cp nostalgia-web:/data/caddy/pki/authorities/local/root.crt .` → extrae un `.crt` de 627
  bytes; validando la cadena completa contra ese archivo con `-CAfile` da
  `Verify return code: 0 (ok)`.
- **No verificado en esta sesión** (entorno sin la extensión de Chrome de Claude conectada y sin un
  segundo dispositivo de LAN disponible): un navegador real completando el *handshake* y
  aceptando el permiso de micrófono contra este servidor, e instalación real de la CA en un cliente
  Windows/macOS/Android/iOS. Queda para que Edward lo confirme en su servidor real y sus
  dispositivos de LAN reales.
