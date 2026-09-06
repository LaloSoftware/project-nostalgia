# ADR 0012 — HTTPS con CA local para el servidor Docker en LAN (Etapa 2)

**Estado:** aceptada — 2026-08-29

## Contexto

El ADR 0011 dejó trazada, pero sin implementar, la Etapa 2: sustituir el `:80` plano del
`Caddyfile` por uno con `tls internal`, para eliminar la bandera
`--unsafely-treat-insecure-origin-as-secure` que hoy hay que pasarle a cada navegador cliente.
Edward reportó que, tras habilitar HTTPS por su cuenta del lado del servidor, los clientes no
lograban conectar — el diagnóstico contra el código mostró que en realidad la Etapa 2 nunca se
había implementado en este repositorio: el `Caddyfile` seguía siendo el bloque `:80 { ... }` de la
Etapa 1, sin ninguna directiva `tls`, y `docker-compose.yml` solo mapeaba `8080:80` — ningún
puerto TLS estaba expuesto en absoluto. No era un error de configuración del servidor; era trabajo
pendiente.

Esta ADR documenta las decisiones concretas al implementarlo — el ADR 0011 ya justificó **por qué
Caddy y por qué `tls internal`** (esa parte no se repite aquí); lo que sigue son las decisiones de
diseño que la implementación real exigió y que el ADR 0011 no podía anticipar sin escribir código.

## Alternativas consideradas

### Certificado emitido por una CA pública real (Let's Encrypt u otra)
Descartada — ya lo estaba en el ADR 0011 y sigue siéndolo: el servidor no tiene salida a internet,
y aunque la tuviera, Let's Encrypt no emite certificados para direcciones IP privadas
(`192.168.0.0/16`, `10.0.0.0/8`, etc.) ni para nombres no resolubles públicamente. No hay forma de
obtener un certificado "de verdad" para un servidor puramente LAN.

### Dejar que Caddy adivine el host (dirección de sitio `:443` sin dominio)
Evaluada primero por ser la config más corta. Descartada: cuando la dirección del sitio no declara
un host, Caddy no tiene forma de saber qué Subject Alternative Name poner en el certificado que
`tls internal` genera — el comportamiento documentado de Caddy en ese caso es limitarse a
`localhost` y las IPs de loopback, que **no sirven para nada en este caso**: los clientes de la LAN
no van a escribir `https://localhost` en la barra de direcciones, van a escribir la IP real del
servidor (ej. `192.168.1.50`), y esa IP tiene que ser el SAN del certificado o el navegador rechaza
la conexión con `ERR_CERT_COMMON_NAME_INVALID` sin importar que la CA sí sea de confianza.

### Variable de entorno obligatoria (`NOSTALGIA_LAN_HOST`, sin valor por defecto) — elegida
Se declara el host real del sitio (`{$NOSTALGIA_LAN_HOST}` en el `Caddyfile`) como variable de
entorno inyectada desde `docker-compose.yml`/`.env`, **sin default**: `${NOSTALGIA_LAN_HOST:?...}`
hace que `docker compose up` falle explícitamente si no está definida, en vez de arrancar con un
certificado emitido para un host vacío o incorrecto que ningún cliente real podría validar.
Alternativa descartada: hardcodear la IP directamente en el `Caddyfile` — se probó mentalmente y
se rechazó porque acopla el control de versiones (el `Caddyfile` es el mismo para cualquier
operador que clone este repo) a un dato que es específico de la red de cada quien y que puede
cambiar (DHCP, mudanza de servidor). Con la variable de entorno, cambiar de IP es editar un
`.env` de una línea y volver a levantar el contenedor — no tocar código versionado.

### Distribución de la CA raíz a los clientes: servirla desde el propio Caddy vs. `docker cp`
Se evaluó agregar una ruta estática en el propio `Caddyfile` que sirviera
`/data/caddy/pki/authorities/local/root.crt` por HTTP plano (sin TLS, ya que descargar la CA es
precisamente el paso previo a poder validar TLS) para que los clientes la bajaran con un solo
click desde el navegador. Se descartó por ahora: exige exponer un segundo puerto adicional
(el `:80` ya se usa para la redirección automática a HTTPS, no para servir archivos propios) y
complica el `Caddyfile` para un paso que solo ocurre una vez por dispositivo cliente. Se eligió
`docker cp nostalgia-web:/data/caddy/pki/authorities/local/root.crt .` — un comando documentado en
`docs/guias/despliegue-docker-lan.md`, ejecutado una vez por el operador del servidor, que luego
distribuye el archivo `.crt` resultante a cada cliente por el medio que prefiera (USB, chat, correo
interno). Queda anotado como mejora futura si la fricción de este paso manual resulta molesta en
la práctica.

### Persistencia de la CA: volumen Docker con nombre vs. bind mount vs. sin persistir
Sin persistir (el comportamiento por defecto sin cambios) fue descartado de inmediato: cada
`docker compose up --build` destruye y recrea el contenedor, y sin un volumen, `/data` — donde
Caddy guarda la clave privada de su CA interna — se pierde con él. Eso invalida la CA ya instalada
en todos los dispositivos cliente, obligando a reinstalarla después de cada reconstrucción, lo cual
habría hecho que la Etapa 2 fuera **peor** en fricción de día a día que la bandera insegura de la
Etapa 1 que se busca eliminar. Entre volumen con nombre (`caddy_data:`) y bind mount a una ruta del
host: se eligió el volumen con nombre por ser gestionado por Docker (no depende de una ruta
absoluta del host que el operador tenga que crear y mantener con los permisos correctos), siguiendo
la misma convención que ya usa la documentación oficial de la imagen `caddy` para `/data`.

### Reemplazar Etapa 1 por completo vs. mantener ambas (HTTP y HTTPS) en paralelo
Se decidió reemplazar: el objetivo explícito de esta etapa (ADR 0011, "Trabajo futuro") es
eliminar la necesidad de la bandera insegura de Chrome, y mantener el puerto HTTP plano expuesto
en paralelo habría conservado exactamente el riesgo que se busca cerrar (el bundle JS/CSS servido
sin integridad para cualquiera en la LAN) sin ninguna ganancia real — nadie tendría motivo para
seguir usando la ruta insegura una vez que la segura funciona. El único puerto 80 que sigue
expuesto ahora es el que Caddy abre automáticamente para redirigir a HTTPS, no para servir
contenido en plano.

## Decisión

`app/docker/Caddyfile`: el bloque `:80 { ... }` de la Etapa 1 se sustituye por
`{$NOSTALGIA_LAN_HOST} { tls internal ... }` — sin puerto explícito, dejando que la función de
"HTTPS automático" nativa de Caddy administre tanto el listener TLS en `:443` como la redirección
HTTP→HTTPS en `:80` para ese mismo host, sin configurarlos a mano por separado.

`app/docker/docker-compose.yml`: agrega `environment: NOSTALGIA_LAN_HOST=${NOSTALGIA_LAN_HOST:?...}`
(obligatoria, sin default), publica `"80:80"` y `"443:443"` (antes solo `"8080:80"`), y agrega el
volumen con nombre `caddy_data:/data` para persistir la CA interna entre reconstrucciones.

`app/docker/.env.example`: plantilla versionada con `NOSTALGIA_LAN_HOST=192.168.1.50` de ejemplo;
`app/docker/.env` (el archivo real, con la IP real del operador) se excluye de git en
`app/.gitignore` y de la imagen en `app/.dockerignore`.

Procedimiento operativo completo (extracción y distribución de la CA, instalación por sistema
operativo del cliente) documentado en `docs/guias/despliegue-docker-lan.md`.

## Números concretos

Medido de verdad en esta sesión, levantando el contenedor en este entorno con
`NOSTALGIA_LAN_HOST=192.168.1.64` (la LAN del equipo de desarrollo, no el servidor real de
Edward — sin un segundo dispositivo de LAN disponible aquí, ver "Verificación" más abajo sobre qué
quedó sin probar):

- Puertos expuestos: antes 1 (`8080`), ahora 2 (`80`, `443`) — ambos puertos estándar y "bien
  conocidos" en vez de uno arbitrario; cualquier escaneo de puertos superficial de la LAN los
  reconoce de inmediato como "un servidor web", lo cual ya era cierto informalmente con `8080`.
- **Vigencia del certificado de hoja emitido por `tls internal`: 12 horas exactas** (verificado con
  `openssl x509 -dates` contra el certificado real servido: `Not Before: Aug 29 18:06:31 2026 GMT`
  / `Not After: Aug 30 06:06:31 2026 GMT`). Esto **corrige una suposición inicial equivocada** de
  este mismo ADR en su primer borrador (se asumió 1 año, por analogía con certificados públicos
  típicos, sin verificarlo) — Caddy usa vida corta a propósito para sus certificados de hoja
  internos y los renueva solo, en segundo plano, sin intervención ni caída del servicio; no se dejó
  el contenedor corriendo 12+ horas en esta sesión para observar una renovación real, así que eso
  queda como pendiente de confirmar, no como verificado.
- Vigencia de la CA raíz (la que sí se instala una sola vez en cada cliente):
  **2026-08-29 a 2036-07-07, ~9 años y 10 meses** (verificado igual con `openssl x509 -dates`
  contra el `root.crt` extraído del volumen).
- Tamaño del `root.crt` extraído: 627 bytes en PEM (ECDSA P-256) — trivial de distribuir por
  cualquier medio (USB, chat, correo).
- Cadena de confianza verificada de extremo a extremo: `openssl s_client ... -CAfile
  nostalgia-lan-ca.crt` contra el certificado servido por el contenedor da
  `Verify return code: 0 (ok)` — el procedimiento documentado en la guía (extraer con `docker cp`,
  instalar como raíz de confianza) sí produce una cadena válida, no solo en teoría.
- Sin cambios en el tamaño de la imagen ni en el tiempo de build respecto al ADR 0011 (`tls
  internal` es una directiva nativa de Caddy, cero dependencias adicionales en la imagen).

### Hallazgo real durante la verificación: SNI es obligatorio, y no todos los clientes lo mandan

Al enviar la conexión de prueba con `curl -k https://192.168.1.64/` desde este Mac, el *handshake*
TLS falla con `LibreSSL: error:1404B438:...:tlsv1 alert internal error` — no es un problema del
contenedor. Diagnóstico reproducido con `openssl s_client`: **sin la extensión SNI, la conexión
falla exactamente igual** (`SSL alert number 80`, el mismo "internal error"); pasando
`-servername 192.168.1.64` explícitamente, la conexión tiene éxito y sirve el certificado correcto.
Causa: el RFC 6066 prohíbe enviar direcciones IP literales como valor de SNI, y el `curl`/LibreSSL
del sistema en macOS respeta esa regla al pie de la letra — omite el SNI por completo cuando el
destino es una IP. Caddy, con un único sitio configurado exactamente para el host
`{$NOSTALGIA_LAN_HOST}`, no tiene ningún certificado que ofrecer para una conexión sin SNI (o con
un SNI que no coincide), así que el propio `crypto/tls` de Go aborta con un alert `internal_error`
genérico en vez de un mensaje claro.

Esto **no bloquea el caso de uso real**: los navegadores de escritorio y móviles mayoritarios
(Chrome, Firefox, Safari) sí envían SNI incluso para IPs literales — es una desviación deliberada
del RFC que los fabricantes de navegadores adoptaron precisamente para poder alcanzar servidores
como este. No se pudo confirmar con un navegador real dentro de este entorno (sin la extensión de
Chrome de Claude conectada), así que la verificación con navegador real sigue pendiente para la
siguiente sesión — ver "Pendiente" en la bitácora. Pero sí es una trampa real para quien intente
diagnosticar esto con `curl`/`wget`/herramientas de línea de comandos en macOS o en cualquier
cliente TLS estrictamente conforme al RFC, y se deja documentada aquí y en la guía para no
repetir el mismo diagnóstico erróneo ("el servidor está roto") la próxima vez.

## Riesgos conocidos

- **Clientes que no envían SNI para IPs literales no pueden conectar** (falla con un
  `tlsv1 alert internal error` genérico, no un mensaje claro) — verificado en esta sesión con el
  `curl` de macOS. Ver el hallazgo completo, con la causa raíz y por qué no afecta a navegadores
  reales, en "Números concretos" más abajo.
- **La CA local, una vez instalada como raíz de confianza en un dispositivo cliente, puede firmar
  certificados válidos para *cualquier* dominio** desde el punto de vista de ese dispositivo — es
  el mismo poder que tiene cualquier CA raíz. El riesgo real es que la clave privada de esa CA vive
  en el volumen `caddy_data` del servidor Docker; quien tenga acceso a ese servidor (o al volumen)
  podría, en teoría, emitir certificados falsos para otros sitios que ese dispositivo cliente
  visite. Se acepta porque el perímetro de confianza ya declarado en el ADR 0011 es la LAN privada
  completa y el propio servidor del operador — no se está confiando en un tercero nuevo.
- **Cambiar `NOSTALGIA_LAN_HOST` (nueva IP del servidor, DHCP que reasignó la dirección) invalida
  el certificado existente** — el SAN ya no coincide con la URL que los clientes visitan. Caddy
  emite uno nuevo automáticamente para el nuevo valor (mismo volumen, misma CA raíz, así que los
  clientes que ya confían en la CA no necesitan reinstalar nada), pero si el servidor no tiene IP
  estática o reservada en el DHCP del router, este valor puede desalinearse silenciosamente sin que
  nada lo avise más allá de que los clientes dejen de poder conectar. No se resuelve aquí — se dejó
  como recomendación en "Qué se sacrifica".
- **Reconstruir el contenedor sin el volumen `caddy_data`** (ej. `docker compose down -v`, o mover
  el despliegue a otra máquina sin migrar el volumen) regenera la CA desde cero y **invalida de
  golpe la confianza ya instalada en todos los dispositivos cliente** — cada uno tendría que
  reinstalar la CA nueva. `docker compose up --build` (sin `-v`, el comando documentado en la guía)
  no toca volúmenes con nombre, así que el flujo normal de reconstrucción tras cambios de código no
  dispara esto — pero es una trampa real si alguien ejecuta `down -v` pensando que es una limpieza
  inocua.
- **Ningún mecanismo de revocación**: si un dispositivo cliente que confía en esta CA se pierde o
  se compromete, no hay forma de revocar solo su confianza sin desinstalar la CA de todos los
  demás dispositivos y generar una nueva (lo que implica perder el volumen `caddy_data` a propósito
  y reinstalar en cada cliente restante). Aceptable dado el tamaño esperado del grupo de
  dispositivos de prueba (los de Edward, en su propia LAN privada), pero no escalaría a un grupo
  grande o no confiable.

## Qué se sacrifica

- **Un paso manual por dispositivo cliente, una sola vez**: instalar la CA raíz como confiable en
  cada sistema operativo (Windows/macOS/Linux/Android/iOS tienen cada uno su propio flujo, todos
  documentados en la guía). La Etapa 1 tenía su propio costo por dispositivo (lanzar Chrome con la
  bandera insegura y un `--user-data-dir` aparte, **en cada arranque**); este costo de la Etapa 2
  se paga una sola vez por dispositivo, no en cada sesión — se considera una mejora neta, pero no
  es gratis.
- **Acoplar el certificado a una IP/host fijo**: si el operador cambia la topología de su LAN con
  frecuencia (IP dinámica sin reserva DHCP), este diseño exige actualizar `.env` y relanzar el
  contenedor cada vez. No se construyó detección automática de cambio de IP ni soporte para
  múltiples SANs simultáneos (ej. servir bajo la IP vieja y la nueva a la vez durante una
  transición) — se recomienda como trabajo futuro fijar una reserva DHCP para este servidor en el
  router, fuera del alcance de este repositorio.
- **El puerto 80 sigue expuesto** (ahora solo para la redirección automática a HTTPS, servido por
  Caddy, no por la app) — no es un retroceso respecto a la Etapa 1 (que también exponía un puerto
  HTTP), pero tampoco es "cerrarlo por completo"; alguien en la LAN todavía puede tocar ese puerto,
  aunque ya no reciba el bundle en plano.

## Trabajo futuro

- Reserva de IP estática (DHCP) para el servidor en el router de la LAN, para que
  `NOSTALGIA_LAN_HOST` no se desalinee silenciosamente.
- Si la instalación manual de la CA por dispositivo resulta ser fricción real en la práctica de
  Edward: reconsiderar servir el `root.crt` desde el propio Caddy por el puerto 80 (descartado
  arriba por desproporción, no por imposibilidad).
