# mspybs-mcp-server

Servidor MCP (Model Context Protocol) que permite a cualquier usuario consultar,
desde un cliente compatible (Claude Desktop, etc.), si una planta de gases
medicinales está **en línea** o **sin señal**, usando los mismos datos que el
dashboard (Google Sheets vía Google Apps Script).

No accede directamente al Sheet: reutiliza el backend de Apps Script ya
desplegado (`backend/google-apps-script.js`), consultando las acciones
`hospitals` y `latest_all`.

## Herramientas expuestas

- **`get_plant_status`** — recibe `plant` (nombre, parte del nombre o ID del
  hospital) y devuelve si está en línea, cuándo fue el último dato recibido
  y hace cuánto.
- **`list_plants_status`** — lista todas las plantas registradas con su
  estado actual.

Una planta se considera **en línea** si su último dato llegó hace menos de
60 segundos (mismo criterio que usa el frontend Next.js).

## Instalación

```bash
cd mcp-server
npm install
```

## Configuración

El servidor necesita la URL de implementación del Apps Script (la misma que
`NEXT_PUBLIC_API_URL` en `frontend/.env.local`):

```
MSPYBS_API_URL=https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec
```

## Uso con Claude Desktop (u otro cliente MCP)

Agrega esto a la configuración MCP del cliente (por ejemplo
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mspybs-plantas": {
      "command": "node",
      "args": ["/ruta/absoluta/al/repo/mcp-server/index.js"],
      "env": {
        "MSPYBS_API_URL": "https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec"
      }
    }
  }
}
```

Luego cualquier usuario del cliente puede preguntar, por ejemplo:

> ¿Está en línea la planta del Hospital de Clínicas?

> Dame el estado de todas las plantas.

y el asistente usará las herramientas `get_plant_status` / `list_plants_status`
para responder con datos reales del Sheet.

## Ejecución manual (debug)

```bash
MSPYBS_API_URL="https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec" npm start
```

El servidor habla el protocolo MCP por stdio; no está pensado para ejecutarse
de forma interactiva en la terminal, sino para ser lanzado por un cliente MCP.
