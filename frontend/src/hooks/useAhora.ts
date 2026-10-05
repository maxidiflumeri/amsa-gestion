import { useEffect, useState } from 'react';

/** Epoch ms que se actualiza cada `cadaMs` mientras `activo`: para textos del tipo "hace N min". */
export function useAhora(activo: boolean, cadaMs = 30_000): number {
    const [ahora, setAhora] = useState(() => Date.now());
    useEffect(() => {
        if (!activo) return;
        setAhora(Date.now());
        const id = setInterval(() => setAhora(Date.now()), cadaMs);
        return () => clearInterval(id);
    }, [activo, cadaMs]);
    return ahora;
}
