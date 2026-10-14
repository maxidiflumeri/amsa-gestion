import { useEffect, useRef, useState } from 'react';
import { obtenerEstadoCarga } from '../api/imports';
import { datosDeGrupo } from '../utils/estadoCarga';

/** Cuánto espera el asistente la respuesta de `ejecutar-grupo` antes de ponerse a mirar el servidor. */
export const VIGIA_ESPERA_MS = 15_000;
/** Cada cuánto mira después. */
export const VIGIA_CADA_MS = 5_000;

/**
 * Vigía de `ejecutar-grupo` (docs/imports-progreso-c2-spec.md §16.6). Mientras `primeraRemesaId` no sea null: a los 15 s
 * empieza a consultar esa remesa cada 5 s; la primera vez que la ve en curso o terminada y con grupo, llama `onGrupo` con
 * el id del grupo y se apaga. Un 404, un error de red o una remesa todavía en borrador no lo detienen. Devuelve si ya pasaron
 * los 15 s (la pantalla avisa que el servidor está tardando).
 */
export function useVigiaGrupo(primeraRemesaId: number | null, onGrupo: (grupoId: string) => void): { tardando: boolean } {
    const [tardando, setTardando] = useState(false);
    const onGrupoRef = useRef(onGrupo);
    onGrupoRef.current = onGrupo;

    useEffect(() => {
        if (primeraRemesaId === null) {
            setTardando(false);
            return;
        }
        let vivo = true;
        let adoptado = false;
        let consultando = false;
        let intervalo: ReturnType<typeof setInterval> | null = null;

        const mirar = async () => {
            if (!vivo || adoptado || consultando) return;
            consultando = true;
            try {
                const real = await obtenerEstadoCarga(primeraRemesaId);
                const datos = real ? datosDeGrupo(real) : null;
                if (vivo && !adoptado && datos !== null && (real.enCurso || real.terminal)) {
                    adoptado = true;
                    if (intervalo) clearInterval(intervalo);
                    onGrupoRef.current(datos.grupoId);
                }
            } catch {
                // Sin red, o la remesa todavía no figura: se sigue mirando.
            } finally {
                consultando = false;
            }
        };

        const espera = setTimeout(() => {
            if (!vivo) return;
            setTardando(true);
            void mirar();
            intervalo = setInterval(() => void mirar(), VIGIA_CADA_MS);
        }, VIGIA_ESPERA_MS);

        return () => {
            vivo = false;
            clearTimeout(espera);
            if (intervalo) clearInterval(intervalo);
            setTardando(false);
        };
    }, [primeraRemesaId]);

    return { tardando };
}
