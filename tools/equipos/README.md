# Equipos ESP32 — alta de hospitales y programación

Herramientas para dar de alta hospitales y preparar, subir y verificar cada ESP32
del monitor de gases medicinales. Se usan en el PC donde se conecta el ESP32 por USB.

## Interfaz gráfica

```bash
cd ~/esp32-MSPYBS && git pull
python3 tools/equipos/equipos_gui.py
```

Se abre el navegador en `http://127.0.0.1:8765` (solo accesible desde tu PC). Para
cerrarla, Ctrl+C en la terminal. Desde **Inicio → Crear acceso directo** queda en el
menú de aplicaciones.

| Menú | Qué hace |
|---|---|
| **Inicio** | Estado de arduino-cli, core ESP32, librerías, esptool y mpremote; instala lo que falta. Puertos USB y permisos. |
| **Configuración** | URL del backend, `DEVICE_TOKEN` y `ADMIN_TOKEN` (no se vuelven a mostrar), URL del dashboard, importar un `secrets.h` que ya funciona, WiFi guardados (editar/eliminar) y el `.bin` de MicroPython. |
| **Hospitales** | Lista con estado y equipos en línea, buscador, filtro activos/inactivos y **Exportar CSV**. Crear hospital con el ID de SIGGAM (o generarlo), dirección y ubicación en el mapa. Por hospital: **Editar** (el id no cambia), **Equipos** (PSA/compresor/vacío), **WiFi**, **+ Equipo**, **Dashboard**, **Mapa**, **Desactivar/Activar** y **Eliminar** (hay que escribir el nombre; mejor desactivar). **Revisar duplicados**: elegir cuál conservar, **Ver plan** y **Fusionar** (el sobrante se desactiva, no se borra). |
| **Equipos** | Asistente "Nuevo equipo" (hospital, qué mide, marca, tipo de ESP32, UNIT_ID sugerido, red del PLC) e inventario con Subir, Verificar, Actualizar firmware, Abrir carpeta, **Editar** (regenera la carpeta), **Duplicar** (siguiente UNIT_ID), **Quitar** del inventario y **Exportar CSV**. |
| **Registro** | Salida en vivo de cada instalación, generación, subida o verificación, con el diagnóstico del resultado. |

Tipos de ESP32:
- **Pasarela PLC** (Arduino + ENC28J60): plantas de O₂ **BOGE**; lee todos los datos
  del generador por el cable LAN.
- **Sensores 4-20 mA** (MicroPython): plantas de **cualquier marca**, compresores y
  vacío. Para leer además un PLC BOGE necesita un módulo W5500.

## Línea de comandos

La interfaz usa por debajo `equipos.py`, que también se puede usar directamente o
desde Claude Code con el skill `/nuevo-equipo`. Ver `python3 tools/equipos/equipos.py --help`.

## Dónde se guarda cada cosa

| Qué | Dónde |
|---|---|
| Carpeta de cada ESP32 | `~/Escritorio/equipos/<hospital>_<unidad>/` |
| URL, tokens, WiFi por hospital e inventario | `~/.config/mspybs/` (solo en tu PC, permisos 600) |

Nada de esto se sube al repositorio.
