# EmpleoCR — monitor del PANI con GitHub Actions

Este repositorio abre la página oficial de reclutamiento del PANI mediante
Playwright y publica el resultado en `data/pani.json`.

## Qué hace

- Ejecuta Chromium en GitHub Actions.
- Revisa el PANI cada seis horas.
- Espera hasta un minuto cuando aparece la comprobación de Cloudflare.
- Extrae el contenido de reclutamiento.
- Guarda el HTML y los enlaces en `data/pani.json`.
- Conserva capturas y HTML de diagnóstico durante siete días.
- No necesita API keys ni servicios de pago.

## Instalación resumida

1. Crea un repositorio **público** en GitHub.
2. Sube todos los archivos de esta carpeta conservando las rutas.
3. Abre la pestaña **Actions**.
4. Entra en **Revisar vacantes del PANI**.
5. Presiona **Run workflow**.
6. Espera a que termine.
7. Abre `data/pani.json` y confirma que contiene `"ok": true`.

La dirección que debes configurar en Apps Script será:

```text
https://raw.githubusercontent.com/TU_USUARIO/TU_REPOSITORIO/main/data/pani.json
```

También puedes pegar simplemente:

```text
https://github.com/TU_USUARIO/TU_REPOSITORIO
```

La versión 4.7 de Apps Script la convertirá automáticamente.

## Importante

GitHub Actions puede ejecutar Playwright, pero no garantiza que Cloudflare
permita el acceso desde las direcciones IP de GitHub. Cuando falle, el flujo
guardará una captura y el HTML de diagnóstico en los artefactos de la
ejecución.
