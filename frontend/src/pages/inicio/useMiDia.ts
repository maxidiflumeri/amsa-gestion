import { useCallback, useEffect, useRef, useState } from 'react';
import { inicioApi, type MiDiaDto } from '../../api/inicio';

/** Cada cuánto se refresca, solo con la pestaña visible. Nada más rápido (docs/inicio-spec.md §6.3). */
export const REFRESCO_MS = 5 * 60_000;
/** Al volver a la pestaña se refresca si el último dato tiene más que esto. */
export const VOLVER_MS = 60_000;

export interface MiDia {
    datos: MiDiaDto | null;
    /** Primera carga en curso (sin ningún dato todavía). */
    cargando: boolean;
    /** El último pedido falló. Con `datos` ya cargados se conserva lo anterior y se avisa; sin ellos, es el error del pedido entero. */
    fallo: boolean;
    /** Sube con cada lectura lograda: lo usan los bloques que piden por su cuenta (B9) para refrescarse con el mismo pulso. */
    pulso: number;
    recargar: () => Promise<void>;
}

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

export function useMiDia(): MiDia {
    const [datos, setDatos] = useState<MiDiaDto | null>(null);
    const [cargando, setCargando] = useState(true);
    const [fallo, setFallo] = useState(false);
    const [pulso, setPulso] = useState(0);
    const montado = useRef(false);
    const enVuelo = useRef<Promise<void> | null>(null);
    const ultimo = useRef(0);
    /** Alguien pidió datos frescos mientras había un pedido en vuelo: se vuelve a pedir apenas termine. */
    const otraVez = useRef(false);

    /**
     * `forzar`: el que llama sabe que algo cambió (terminó un reporte o una importación, o tocó Reintentar). Si hay un
     * pedido en vuelo, ese pedido puede haber salido antes del cambio: se pide de nuevo apenas termine.
     */
    const pedir = useCallback((forzar: boolean): Promise<void> => {
        // Nunca dos pedidos a la vez.
        if (enVuelo.current) {
            if (forzar) otraVez.current = true;
            return enVuelo.current;
        }
        const p = inicioApi
            .miDia()
            .then((d) => {
                if (!montado.current) return;
                ultimo.current = Date.now();
                setDatos(d);
                setFallo(false);
                setPulso((n) => n + 1);
            })
            .catch(() => {
                if (!montado.current) return;
                setFallo(true);
            })
            .finally(() => {
                enVuelo.current = null;
                if (montado.current) setCargando(false);
                if (otraVez.current && montado.current) {
                    otraVez.current = false;
                    void pedir(false);
                }
            });
        enVuelo.current = p;
        return p;
    }, []);

    const recargar = useCallback(() => pedir(true), [pedir]);

    useEffect(() => {
        montado.current = true;
        void pedir(false);
        const reloj = setInterval(() => {
            // Si al volver a la pestaña ya se refrescó hace poco, este tic no vuelve a pedir.
            if (visible() && Date.now() - ultimo.current >= REFRESCO_MS - 30_000) void pedir(false);
        }, REFRESCO_MS);
        const alVolver = () => {
            if (visible() && Date.now() - ultimo.current > VOLVER_MS) void pedir(false);
        };
        document.addEventListener('visibilitychange', alVolver);
        return () => {
            montado.current = false;
            clearInterval(reloj);
            document.removeEventListener('visibilitychange', alVolver);
        };
    }, [pedir]);

    return { datos, cargando, fallo, pulso, recargar };
}
