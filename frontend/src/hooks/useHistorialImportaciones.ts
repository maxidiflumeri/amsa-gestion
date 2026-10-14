import { useCallback, useEffect, useRef, useState } from 'react';
import { obtenerHistorial } from '../api/imports';
import { useSocket } from '../context/SocketContext';
import type { GrupoHistorialDto, HistorialItemDto } from '../types/importHistorial';
import type { EstadoCargaDto } from '../types/importProgreso';
import {
    POLL_LISTA_MS,
    REFRESCO_COLA_MS,
    REFRESCO_HISTORIAL_QUIETO_MS,
    SILENCIO_MS,
    crearRefrescoLimitado,
    esEstadoCarga,
    fusionarEstadoCarga,
} from '../utils/estadoCarga';

const EVENTOS_IMPORT = ['import:iniciada', 'import:progreso', 'import:finalizada'] as const;
/** El intervalo avanza de a 15 s: «30 s de silencio» se mide con un segundo de tolerancia para no esperar un tick más. */
const TOLERANCIA_TICK_MS = 1_000;

interface ParametrosHistorial {
    empresaId: number | null;
    page: number;
    pageSize: number;
    q: string;
}

interface UseHistorialImportaciones {
    items: HistorialItemDto[];
    grupos: Record<string, GrupoHistorialDto>;
    total: number;
    totalPages: number;
    /** Primera carga de estos parámetros. */
    cargando: boolean;
    /** Hay una consulta pedida por la persona en vuelo sobre datos ya mostrados. */
    refrescando: boolean;
    /** La última consulta de primer plano falló y no hay datos que mostrar. */
    error: boolean;
    refrescar: () => Promise<void>;
    /** Aplica lo que devolvió una acción (la `carga` de una remesa de la página). */
    aplicarCarga: (dto: EstadoCargaDto) => void;
    /** Saca una remesa de la lista (tras eliminarla). */
    quitar: (remesaId: number) => void;
}

/** Fusiona la `carga` nueva con la que ya había por `rev`; el resto de los campos se toman siempre de la respuesta. */
function fusionarItem(previo: HistorialItemDto | undefined, nuevo: HistorialItemDto): HistorialItemDto {
    if (!previo) return nuevo;
    return { ...nuevo, carga: fusionarEstadoCarga(previo.carga, nuevo.carga) };
}

/**
 * La lista del Historial, viva (docs/imports-progreso-c2-spec.md §6.2). El socket actualiza las filas de la página
 * sin consultar; lo que el socket no cubre (cargas de otros sin `importacion.ver_progreso_otros`, borradores nuevos,
 * eliminaciones) se recupera por consulta: nunca más de 30 s atrás con una carga en curso a la vista, un minuto sin ninguna.
 * Mismas reglas que `useEstadoCarga` y `useGrupoCarga`: cada evento es una foto completa y se fusiona por `rev`.
 */
export function useHistorialImportaciones({ empresaId, page, pageSize, q }: ParametrosHistorial): UseHistorialImportaciones {
    const { socket, conectado, conexiones } = useSocket();
    const [items, setItems] = useState<HistorialItemDto[]>([]);
    const [grupos, setGrupos] = useState<Record<string, GrupoHistorialDto>>({});
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [cargando, setCargando] = useState<boolean>(empresaId !== null);
    const [refrescando, setRefrescando] = useState(false);
    const [error, setError] = useState(false);

    const clave = `${empresaId ?? ''}|${page}|${pageSize}|${q}`;
    const claveRef = useRef(clave);
    const paramsRef = useRef<ParametrosHistorial>({ empresaId, page, pageSize, q });
    const itemsRef = useRef<HistorialItemDto[]>([]);
    const conectadoRef = useRef(conectado);
    const conexionesPrevRef = useRef(conexiones);
    const ultimaNovedadRef = useRef(Date.now());
    /** Número de pedido: una respuesta más vieja que la última aplicada se descarta (llegan desordenadas). */
    const pedidoRef = useRef(0);
    const ultimoAplicadoRef = useRef(0);
    conectadoRef.current = conectado;
    itemsRef.current = items;
    paramsRef.current = { empresaId, page, pageSize, q };

    /** `deLaPersona`: la consulta la pidió alguien (se ve la barra y un fallo se muestra); las de fondo no tocan nada si fallan. */
    const consultar = useCallback(async (deLaPersona: boolean): Promise<void> => {
        const p = paramsRef.current;
        if (p.empresaId === null) return;
        const claveDelPedido = claveRef.current;
        const numero = ++pedidoRef.current;
        if (deLaPersona) {
            if (itemsRef.current.length > 0) setRefrescando(true);
            else setCargando(true);
        }
        try {
            const r = await obtenerHistorial({ empresaId: p.empresaId, page: p.page, pageSize: p.pageSize, q: p.q || undefined }, { silencioso: true });
            if (claveRef.current !== claveDelPedido || numero < ultimoAplicadoRef.current || !Array.isArray(r?.data)) return;
            ultimoAplicadoRef.current = numero;
            ultimaNovedadRef.current = Date.now();
            const previos = new Map(itemsRef.current.map((i) => [i.id, i]));
            setItems(r.data.map((nuevo) => fusionarItem(previos.get(nuevo.id), nuevo)));
            setGrupos(r.grupos && typeof r.grupos === 'object' ? r.grupos : {});
            setTotal(typeof r.total === 'number' ? r.total : r.data.length);
            setTotalPages(typeof r.totalPages === 'number' ? r.totalPages : 1);
            setError(false);
        } catch {
            if (deLaPersona && claveRef.current === claveDelPedido && itemsRef.current.length === 0) setError(true);
        } finally {
            if (claveRef.current === claveDelPedido) {
                setCargando(false);
                setRefrescando(false);
            }
        }
    }, []);

    const refrescar = useCallback(async () => {
        setError(false);
        await consultar(true);
    }, [consultar]);

    // Al montar o cambiar de empresa, página, tamaño o búsqueda: empezar de cero y consultar en primer plano.
    useEffect(() => {
        claveRef.current = clave;
        setItems([]);
        itemsRef.current = [];
        setGrupos({});
        setTotal(0);
        setTotalPages(0);
        setError(false);
        setRefrescando(false);
        setCargando(empresaId !== null);
        ultimaNovedadRef.current = Date.now();
        if (empresaId !== null) void consultar(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clave, consultar]);

    // Eventos de socket: cada uno es una foto completa. Lo que no pasa esEstadoCarga, o es de otra empresa, se ignora.
    useEffect(() => {
        if (!socket) return;
        const pedirRefresco = crearRefrescoLimitado(() => void consultar(false), REFRESCO_COLA_MS);
        const onEvento = (data: unknown) => {
            if (!esEstadoCarga(data) || data.empresaId !== paramsRef.current.empresaId) return;
            ultimaNovedadRef.current = Date.now();
            const previo = itemsRef.current.find((i) => i.id === data.remesaId);
            if (previo) {
                const fusionada = fusionarEstadoCarga(previo.carga, data);
                if (fusionada === previo.carga) return;
                setItems((prev) => prev.map((i) => (i.id === data.remesaId ? { ...i, carga: fusionarEstadoCarga(i.carga, data) } : i)));
                // Cambian el resumen del grupo, `retomable` y `pendienteDeEncolar`, que no viajan en el evento.
                if (data.terminal && !previo.carga.terminal) pedirRefresco.pedir();
                return;
            }
            // Una remesa que no está en la página: en la primera, sin búsqueda, es una carga recién confirmada.
            const { page: pagina, q: busqueda } = paramsRef.current;
            if (pagina === 1 && !busqueda) pedirRefresco.pedir();
        };
        EVENTOS_IMPORT.forEach((ev) => socket.on(ev, onEvento));
        return () => {
            EVENTOS_IMPORT.forEach((ev) => socket.off(ev, onEvento));
            pedirRefresco.cancelar();
        };
    }, [socket, consultar]);

    // Cada conexión (la primera y cada reconexión) puede haber dejado eventos sin recibir.
    useEffect(() => {
        if (conexiones === conexionesPrevRef.current) return;
        conexionesPrevRef.current = conexiones;
        void consultar(false);
    }, [conexiones, consultar]);

    // Volver a la pestaña o recuperar la red.
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') void consultar(false);
        };
        const onOnline = () => void consultar(false);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
        };
    }, [consultar]);

    // Con una carga en curso a la vista: consulta si el socket está caído o si lleva 30 s callado.
    useEffect(() => {
        const id = setInterval(() => {
            if (document.hidden || !itemsRef.current.some((i) => i.carga.enCurso)) return;
            if (!conectadoRef.current || Date.now() - ultimaNovedadRef.current >= SILENCIO_MS - TOLERANCIA_TICK_MS) void consultar(false);
        }, POLL_LISTA_MS);
        return () => clearInterval(id);
    }, [consultar]);

    // Sin ninguna en curso, en la primera página y sin búsqueda: una vez por minuto (alguien pudo crear o eliminar algo).
    useEffect(() => {
        const id = setInterval(() => {
            if (document.hidden || itemsRef.current.some((i) => i.carga.enCurso)) return;
            const { page: pagina, q: busqueda } = paramsRef.current;
            if (pagina === 1 && !busqueda) void consultar(false);
        }, REFRESCO_HISTORIAL_QUIETO_MS);
        return () => clearInterval(id);
    }, [consultar]);

    const aplicarCarga = useCallback((dto: EstadoCargaDto) => {
        if (!esEstadoCarga(dto)) return;
        setItems((prev) => prev.map((i) => (i.id === dto.remesaId ? { ...i, carga: fusionarEstadoCarga(i.carga, dto) } : i)));
        ultimaNovedadRef.current = Date.now();
    }, []);

    const quitar = useCallback((remesaId: number) => {
        setItems((prev) => prev.filter((i) => i.id !== remesaId));
        setTotal((t) => Math.max(0, t - 1));
    }, []);

    return { items, grupos, total, totalPages, cargando, refrescando, error, refrescar, aplicarCarga, quitar };
}
