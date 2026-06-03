'use client';

import { useEffect, useRef, useCallback } from 'react';

export function usePolling(fn: () => void | Promise<void>, intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    try { await fnRef.current(); } catch { /* el componente maneja errores */ }
  }, []);

  useEffect(() => {
    run();
    const id = setInterval(run, intervalMs);
    return () => clearInterval(id);
  }, [run, intervalMs]);
}
