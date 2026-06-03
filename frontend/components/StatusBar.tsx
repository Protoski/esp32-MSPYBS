'use client';

/**
 * StatusBar — Barra superior que muestra el estado de la conexión
 * y la hora del último dato recibido.
 */

import React from 'react';

interface StatusBarProps {
  lastUpdate:   string | null;
  isConnected:  boolean;
  isPolling:    boolean;
  errorMessage: string | null;
}

export default function StatusBar({
  lastUpdate,
  isConnected,
  isPolling,
  errorMessage,
}: StatusBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-xs">
      {/* Estado de conexión */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          errorMessage ? 'bg-red-500 animate-pulse' :
          isConnected  ? 'bg-green-400 animate-pulse' :
                         'bg-slate-600'
        }`} />
        <span className={
          errorMessage ? 'text-red-400' :
          isConnected  ? 'text-green-400' :
                         'text-slate-500'
        }>
          {errorMessage
            ? `Error: ${errorMessage}`
            : isConnected
            ? 'Conectado — datos en tiempo real'
            : 'Desconectado'}
        </span>
      </div>

      {/* Timestamp del último dato */}
      <div className="flex items-center gap-3 text-slate-500">
        {isPolling && (
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10"
                stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            Actualizando…
          </span>
        )}
        {lastUpdate && (
          <span>Último dato: <strong className="text-slate-300">{lastUpdate}</strong></span>
        )}
        <span className="text-slate-600">Polling cada 5 s</span>
      </div>
    </div>
  );
}
