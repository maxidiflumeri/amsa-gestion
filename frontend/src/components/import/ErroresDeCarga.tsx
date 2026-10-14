import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Tab, Tabs, TablePagination, Tooltip, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { descargarErroresCsv, obtenerErrores } from '../../api/imports';
import { useConfirm } from '../../context/ConfirmContext';
import { useNotify } from '../../hooks/useNotify';
import type { ErrorDeCargaDto, ErroresRespuesta } from '../../types/importHistorial';
import type { EstadoCargaDto } from '../../types/importProgreso';
import { REFRESCO_COLA_MS, crearRefrescoLimitado, esAvisoDeCarga, formatearNumero } from '../../utils/estadoCarga';
import { descargarBlob, mensajeDeErrorDeBlob } from '../../utils/descargas';
import { DataTableResponsive, SectionCard, StatusChip } from '../ui';
import type { DataTableColumn } from '../ui';

/** Tope de líneas del CSV que arma el backend (§5.4). */
const TOPE_CSV = 200_000;
const TAMANOS = [25, 50, 100];

type Pestana = 'FILA' | 'AVISO';
type FilaDeErrores = ErrorDeCargaDto & Record<string, unknown>;

interface Props {
    remesaId: number;
    numeroRemesa: string;
    /** El estado en vivo de la carga: de ahí salen cuándo pedir y cuándo volver a pedir. */
    carga: EstadoCargaDto | null;
    /** En Claves de pago las filas son trámites. */
    esMulticlaves: boolean;
}

/**
 * Los errores de una carga (docs/imports-progreso-c2-spec.md §6.5): paginados del lado del servidor, separados en errores
 * de fila y avisos, vivos mientras la carga corre y descargables en CSV. Nunca dice «no hay errores» contra lo que dice la carga.
 */
export default function ErroresDeCarga({ remesaId, numeroRemesa, carga, esMulticlaves }: Props) {
    const notify = useNotify();
    const confirm = useConfirm();
    const err = carga?.err ?? 0;
    const advertencias = carga?.advertencias ?? 0;
    const enCurso = carga?.enCurso === true;
    const terminal = carga?.terminal === true;
    // Una remesa terminal heredada (rev 0) no trae el contador de avisos: se piden igual.
    const heredadaTerminal = terminal && carga?.rev === 0;
    const pedir = carga !== null && (err > 0 || advertencias > 0 || heredadaTerminal);

    const [pestana, setPestana] = useState<Pestana>(err > 0 || heredadaTerminal ? 'FILA' : 'AVISO');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [datos, setDatos] = useState<ErroresRespuesta | null>(null);
    const [fallo, setFallo] = useState(false);
    const [descargando, setDescargando] = useState(false);

    const paramsRef = useRef({ remesaId, pestana, page, pageSize });
    paramsRef.current = { remesaId, pestana, page, pageSize };
    const pedidoRef = useRef(0);
    const aplicadoRef = useRef(0);
    const pedirRef = useRef(pedir);
    pedirRef.current = pedir;

    /** Una lectura nueva con los parámetros de ahora. `silenciosa`: no toca la pantalla si falla y hay datos. */
    const cargar = useCallback(async () => {
        const p = paramsRef.current;
        if (!pedirRef.current) return;
        const numero = ++pedidoRef.current;
        try {
            const r = await obtenerErrores(p.remesaId, { tipo: p.pestana, page: p.page, pageSize: p.pageSize, orden: 'asc' }, { silencioso: true });
            const actual = paramsRef.current;
            if (numero < aplicadoRef.current || actual.remesaId !== p.remesaId || !r || !Array.isArray(r.data)) {
                if (numero >= aplicadoRef.current && !(r && Array.isArray(r.data))) setFallo(true);
                return;
            }
            aplicadoRef.current = numero;
            setDatos(r);
            setFallo(false);
        } catch {
            setFallo(true);
        }
    }, []);

    // Al abrir otra remesa: de cero.
    useEffect(() => {
        setDatos(null);
        setFallo(false);
        setPage(1);
        aplicadoRef.current = 0;
        pedidoRef.current = 0;
    }, [remesaId]);

    // Pide al abrir, al cambiar de pestaña o de página, y cuando la carga pasa a tener algo que mostrar.
    useEffect(() => {
        if (pedir) void cargar();
    }, [pedir, remesaId, pestana, page, pageSize, cargar]);

    // En vivo: cada vez que cambian los contadores, a lo sumo una vez cada 5 s, y una más al terminar.
    const refrescoLimitado = useRef(crearRefrescoLimitado(() => void cargar(), REFRESCO_COLA_MS));
    const contadoresVistos = useRef({ err, advertencias });
    useEffect(() => {
        // Solo cuando cambian los contadores (no al montar): el doble efecto del modo estricto no cuenta como un cambio.
        if (contadoresVistos.current.err === err && contadoresVistos.current.advertencias === advertencias) return;
        contadoresVistos.current = { err, advertencias };
        if (enCurso) refrescoLimitado.current.pedir();
    }, [err, advertencias, enCurso]);
    const terminalPrevio = useRef(terminal);
    useEffect(() => {
        if (terminal && !terminalPrevio.current) {
            refrescoLimitado.current.cancelar();
            void cargar();
        }
        terminalPrevio.current = terminal;
    }, [terminal, cargar]);
    useEffect(() => () => refrescoLimitado.current.cancelar(), []);

    const totales = datos?.totales ?? null;
    const backendViejo = datos !== null && totales === null;

    // La pestaña vacía cede el lugar a la otra: la carga puede traer solo avisos, o solo errores.
    useEffect(() => {
        if (!totales) return;
        if (pestana === 'FILA' && totales.filas === 0 && totales.avisos > 0 && err === 0) { setPestana('AVISO'); setPage(1); }
        else if (pestana === 'AVISO' && totales.avisos === 0 && totales.filas > 0) { setPestana('FILA'); setPage(1); }
    }, [totales, pestana, err]);

    // Un backend anterior no manda totales ni filtra: una sola lista de hasta 100.
    useEffect(() => {
        if (backendViejo && pageSize !== 100) { setPageSize(100); setPage(1); }
    }, [backendViejo, pageSize]);

    if (!pedir && datos === null) return null;
    // Las dos en cero y la carga no dice que haya nada: no se muestra la tarjeta.
    if (totales !== null && totales.filas === 0 && totales.avisos === 0 && err === 0 && advertencias === 0) return null;

    const etiquetaFila = esMulticlaves ? 'Trámite' : 'Fila';
    const tooltipFila = `Posición entre ${esMulticlaves ? 'los trámites' : 'las filas'} que procesó esta carga, contando desde 1. No cuenta el encabezado ni las filas descartadas por un filtro. Para ubicar el registro, mirá la columna con el contenido de la fila.`;

    const columnas: DataTableColumn<FilaDeErrores>[] = [
        {
            key: 'fila',
            label: (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                    {etiquetaFila}
                    <Tooltip title={tooltipFila}><InfoOutlinedIcon fontSize="inherit" aria-label={tooltipFila} /></Tooltip>
                </Box>
            ),
            render: (row) => {
                if (row.tipo === 'FILA') return row.fila != null ? String(row.fila) : '—';
                if (row.tipo === 'AVISO') return '—';
                // Backend sin `tipo`: como antes.
                return esAvisoDeCarga(row.errorMsg) ? '—' : String(row.rowNumber);
            },
        },
        {
            key: 'errorMsg',
            label: 'Mensaje de error',
            primary: true,
            render: (row) => (
                <Box sx={{ maxWidth: 320, wordBreak: 'break-word' }}>
                    <StatusChip status="failed" label={String(row.errorMsg)} sx={{ height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal' } }} />
                </Box>
            ),
        },
        {
            key: 'rawRow',
            label: 'Fila original (JSON)',
            secondary: true,
            render: (row) => (
                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-all' }}>
                    {row.rawRow == null ? '—' : JSON.stringify(row.rawRow)}
                </Typography>
            ),
        },
    ];

    // La carga dice que hay errores y la lectura dice que no: nunca se le muestra al operador «no hay».
    const incoherente = totales !== null && ((err > 0 && totales.filas === 0) || (advertencias > 0 && totales.avisos === 0 && err === 0));
    const sinDatosAun = datos === null && !fallo;

    const descargar = async () => {
        if (descargando) return;
        const cantidad = (totales?.filas ?? 0) + (totales?.avisos ?? 0);
        if (cantidad > TOPE_CSV) {
            const acepta = await confirm({
                title: 'Descargar CSV',
                description: `Esta carga tiene ${formatearNumero(cantidad)} errores y avisos. El archivo va a traer los primeros ${formatearNumero(TOPE_CSV)}.`,
                confirmLabel: 'Descargar',
            });
            if (!acepta) return;
        }
        setDescargando(true);
        try {
            const blob = await descargarErroresCsv(remesaId, 'TODOS');
            descargarBlob(blob, `errores-remesa-${numeroRemesa}.csv`);
        } catch (e) {
            notify.error(await mensajeDeErrorDeBlob(e));
        } finally {
            setDescargando(false);
        }
    };

    const titulo = backendViejo
        ? (err > 0 ? (esMulticlaves ? 'Trámites rechazados' : 'Errores de fila') : 'Avisos de la carga')
        : undefined;

    const filas = (datos?.data ?? []) as FilaDeErrores[];
    const ordenadas = backendViejo
        ? [...filas].sort((a, b) => Number(!esAvisoDeCarga(a.errorMsg)) - Number(!esAvisoDeCarga(b.errorMsg)))
        : filas;
    const hayPestanas = totales !== null && (totales.filas > 0 || totales.avisos > 0);

    return (
        <SectionCard title={titulo} noPadding>
            {fallo && datos === null ? (
                <Box sx={{ p: 2 }}>
                    <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => void cargar()}>Reintentar</Button>}>
                        No se pudieron leer los errores
                    </Alert>
                </Box>
            ) : sinDatosAun ? (
                <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>
            ) : (
                <>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ px: 2, pt: hayPestanas ? 0 : 2 }}>
                        {hayPestanas && totales ? (
                            <Tabs value={pestana} onChange={(_e, v: Pestana) => { setPestana(v); setPage(1); }} variant="scrollable" scrollButtons="auto">
                                {totales.filas > 0 && <Tab value="FILA" label={`${esMulticlaves ? 'Trámites rechazados' : 'Errores de fila'} (${formatearNumero(totales.filas)})`} />}
                                {totales.avisos > 0 && <Tab value="AVISO" label={`Avisos (${formatearNumero(totales.avisos)})`} />}
                            </Tabs>
                        ) : <Box />}
                        {totales !== null && totales.filas + totales.avisos > 0 && (
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={descargando ? <CircularProgress size={14} /> : <DownloadIcon />}
                                disabled={descargando}
                                onClick={() => void descargar()}
                            >
                                Descargar CSV
                            </Button>
                        )}
                    </Stack>
                    {incoherente ? (
                        <Box sx={{ p: 2 }}>
                            <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => void cargar()}>Reintentar</Button>}>
                                No se pudieron leer los errores
                            </Alert>
                        </Box>
                    ) : (
                        <>
                            <DataTableResponsive<FilaDeErrores>
                                columns={columnas}
                                rows={ordenadas}
                                rowKey={(row) => String(row.id)}
                                emptyMessage={enCurso ? 'Los errores de una carga en curso se actualizan a medida que aparecen.' : 'No hay registros para mostrar.'}
                            />
                            {!backendViejo && datos !== null && (
                                <TablePagination
                                    component="div"
                                    count={datos.total}
                                    page={Math.max(0, page - 1)}
                                    onPageChange={(_e, nueva) => setPage(nueva + 1)}
                                    rowsPerPage={pageSize}
                                    rowsPerPageOptions={TAMANOS}
                                    onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                                    labelRowsPerPage="Por página:"
                                    labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                                />
                            )}
                        </>
                    )}
                </>
            )}
        </SectionCard>
    );
}
