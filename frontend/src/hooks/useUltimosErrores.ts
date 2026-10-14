import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { obtenerErrores } from '../api/imports';
import type { UltimosErrores } from '../components/import/progreso/TarjetaProgreso';
import type { ErroresRespuesta } from '../types/importHistorial';
import type { EstadoCargaDto } from '../types/importProgreso';
import { REFRESCO_COLA_MS, crearRefrescoLimitado } from '../utils/estadoCarga';

const PARAMS = { tipo: 'TODOS', orden: 'desc', reciente: true, page: 1, pageSize: 5 } as const;

/**
 * Los últimos 5 errores y avisos de una carga, para la tarjeta de progreso (docs/imports-progreso-c2-spec.md §16.4.4).
 * Una lectura cuando la carga pasa a tener algo que mostrar, otra cada vez que cambian sus contadores (a lo sumo una cada
 * 5 s) y una más al terminar. `activo=false` apaga todo. Null mientras no hay una lectura (ni un fallo) que mostrar.
 */
export function useUltimosErrores(carga: EstadoCargaDto | null, activo = true): UltimosErrores | null {
    const remesaId = carga?.remesaId ?? null;
    const err = carga?.err ?? 0;
    const advertencias = carga?.advertencias ?? 0;
    const enCurso = carga?.enCurso === true;
    const terminal = carga?.terminal === true;
    const pedir = activo && remesaId !== null && (err > 0 || advertencias > 0);

    const [datos, setDatos] = useState<Pick<ErroresRespuesta, 'data' | 'totales'> | null>(null);
    const [fallo, setFallo] = useState(false);

    const remesaRef = useRef<number | null>(remesaId);
    remesaRef.current = remesaId;
    const pedirRef = useRef(pedir);
    pedirRef.current = pedir;
    const pedidoRef = useRef(0);
    const aplicadoRef = useRef(0);
    /** La remesa para la que ya se hizo la primera lectura (el doble efecto del modo estricto no la repite). */
    const leidaRef = useRef<number | null>(null);
    const vistaRef = useRef<number | null>(null);

    const cargar = useCallback(async () => {
        const id = remesaRef.current;
        if (id === null || !pedirRef.current) return;
        const numero = ++pedidoRef.current;
        try {
            const r = await obtenerErrores(id, PARAMS, { silencioso: true });
            if (numero < aplicadoRef.current || remesaRef.current !== id) return;
            if (!r || !Array.isArray(r.data)) {
                setFallo(true);
                return;
            }
            aplicadoRef.current = numero;
            setDatos({ data: r.data, totales: r.totales ?? null });
            setFallo(false);
        } catch {
            if (remesaRef.current === id) setFallo(true);
        }
    }, []);

    const cargarRef = useRef(cargar);
    cargarRef.current = cargar;
    const nuevoRefresco = () => crearRefrescoLimitado(() => void cargarRef.current(), REFRESCO_COLA_MS);
    const refresco = useRef(nuevoRefresco());
    const contadoresRef = useRef({ remesaId, err, advertencias });

    // Primera lectura (por el refresco limitado: abre la ventana de 5 s) y limpieza al abrir otra remesa.
    useEffect(() => {
        if (vistaRef.current !== remesaId) {
            vistaRef.current = remesaId;
            leidaRef.current = null;
            pedidoRef.current = 0;
            aplicadoRef.current = 0;
            contadoresRef.current = { remesaId, err, advertencias };
            // Otra remesa, otra ventana: su primera lectura no espera a la de la anterior.
            refresco.current.cancelar();
            refresco.current = nuevoRefresco();
            setDatos(null);
            setFallo(false);
        }
        if (!pedir || remesaId === null || leidaRef.current === remesaId) return;
        leidaRef.current = remesaId;
        // Los contadores que dispararon esta lectura ya están reflejados en ella: no piden otra.
        contadoresRef.current = { remesaId, err, advertencias };
        refresco.current.pedir();
    }, [remesaId, pedir, err, advertencias]);

    // En vivo: cuando cambian los contadores de una carga en curso, a lo sumo una lectura cada 5 s.
    useEffect(() => {
        const visto = contadoresRef.current;
        if (visto.remesaId !== remesaId) {
            contadoresRef.current = { remesaId, err, advertencias };
            return;
        }
        if (visto.err === err && visto.advertencias === advertencias) return;
        contadoresRef.current = { remesaId, err, advertencias };
        if (enCurso && pedirRef.current && leidaRef.current === remesaId) refresco.current.pedir();
    }, [remesaId, err, advertencias, enCurso]);

    // Al terminar, una más (y se cancela la pendiente).
    const terminalPrevio = useRef(terminal);
    useEffect(() => {
        if (terminal && !terminalPrevio.current && pedirRef.current) {
            refresco.current.cancelar();
            void cargarRef.current();
        }
        terminalPrevio.current = terminal;
    }, [terminal]);

    useEffect(() => () => refresco.current.cancelar(), []);

    return useMemo(() => {
        if (datos) return { items: datos.data, totales: datos.totales, fallo };
        return fallo ? { items: [], totales: null, fallo: true } : null;
    }, [datos, fallo]);
}
