// Copia este archivo como secrets.h (misma carpeta que plant_monitor.ino)
// y pon tus datos. secrets.h no se sube al repositorio.
#pragma once

const char* WIFI_SSID     = "TU_SSID_WIFI";
const char* WIFI_PASSWORD = "TU_PASSWORD_WIFI";

// La misma URL que NEXT_PUBLIC_API_URL en Vercel, para que los datos
// lleguen al backend que lee el dashboard.
const char* API_URL = "https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec";

// Debe coincidir con DEVICE_TOKEN en Apps Script:
// Configuración del proyecto > Propiedades del script.
const char* DEVICE_TOKEN = "TU_DEVICE_TOKEN";
