'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Hospital } from '@/types/plant';

interface HospitalCtx {
  hospitals:       Hospital[];
  setHospitals:    (h: Hospital[]) => void;
  selected:        Hospital | null;
  setSelected:     (h: Hospital | null) => void;
  isLoading:       boolean;
  setIsLoading:    (v: boolean) => void;
}

const Ctx = createContext<HospitalCtx>({
  hospitals:    [],
  setHospitals: () => {},
  selected:     null,
  setSelected:  () => {},
  isLoading:    true,
  setIsLoading: () => {},
});

export function HospitalProvider({ children }: { children: React.ReactNode }) {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selected,  setSelected]  = useState<Hospital | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('selected_hospital');
    if (saved) {
      try { setSelected(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (selected) localStorage.setItem('selected_hospital', JSON.stringify(selected));
  }, [selected]);

  return (
    <Ctx.Provider value={{ hospitals, setHospitals, selected, setSelected, isLoading, setIsLoading }}>
      {children}
    </Ctx.Provider>
  );
}

export const useHospitals = () => useContext(Ctx);
