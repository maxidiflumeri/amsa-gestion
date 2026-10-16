// src/pages/Inicio.tsx — "Tu día" (docs/inicio-spec.md). Cada bloque decide solo por permisos, no por el nombre del rol.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Grid, Stack } from '@mui/material';
import { PageContainer } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useImportacionesEnCurso } from '../hooks/useImportacionesEnCurso';
import { usePageTitle } from '../hooks/usePageTitle';
import ActividadCard from './inicio/components/ActividadCard';
import AgendaCard, { type PestanaAgenda } from './inicio/components/AgendaCard';
import GestionesSerieCard from './inicio/components/GestionesSerieCard';
import ImportacionesCard from './inicio/components/ImportacionesCard';
import ReportesCard from './inicio/components/ReportesCard';
import RetomarCard from './inicio/components/RetomarCard';
import SaludoBuscador from './inicio/components/SaludoBuscador';
import TuDiaKpis from './inicio/components/TuDiaKpis';
import { bloquesVisibles, distribuir, puedeBuscar, type BloqueId } from './inicio/reglasBloques';
import { useMiDia } from './inicio/useMiDia';

const Inicio: React.FC = () => {
    usePageTitle('Inicio');
    const { usuario, tienePermiso } = useAuth();
    const { datos, cargando, fallo, pulso, recargar } = useMiDia();
    const [buscadorAbierto, setBuscadorAbierto] = useState(false);
    const [pestana, setPestana] = useState<PestanaAgenda>('hoy');
    const agendaRef = useRef<HTMLDivElement | null>(null);

    // B8: solo las cargas propias. Quien tiene `ver_progreso_otros` también recibe las ajenas por el socket.
    const enCursoPropias = useImportacionesEnCurso().filter((c) => c.usuarioId === usuario?.id);
    const terminadasHoy = datos?.importacionesHoy ?? [];

    // Una carga propia que deja de estar en curso terminó: "Terminadas hoy" sale de `mi-dia`, así que se pide de nuevo.
    // Mientras tanto el bloque se mantiene: si no, desaparece y la columna salta hasta el próximo refresco.
    const idsEnCurso = enCursoPropias.map((c) => c.remesaId).sort((a, b) => a - b).join(',');
    const idsPreviosRef = useRef<string>('');
    const [reteniendoB8, setReteniendoB8] = useState(false);
    useEffect(() => {
        const previos = idsPreviosRef.current ? idsPreviosRef.current.split(',') : [];
        const actuales = new Set(idsEnCurso ? idsEnCurso.split(',') : []);
        idsPreviosRef.current = idsEnCurso;
        if (previos.some((id) => !actuales.has(id))) {
            setReteniendoB8(true);
            void recargar();
        }
    }, [idsEnCurso, recargar]);
    useEffect(() => {
        setReteniendoB8(false);
    }, [pulso]);

    const visibles = useMemo(
        () => bloquesVisibles(tienePermiso, { hayImportaciones: enCursoPropias.length > 0 || terminadasHoy.length > 0 || reteniendoB8 }),
        [tienePermiso, enCursoPropias.length, terminadasHoy.length, reteniendoB8],
    );
    const { principal, lateral, modo } = distribuir(visibles);

    const abrirBuscador = useCallback(() => setBuscadorAbierto(true), []);
    const cerrarBuscador = useCallback(() => setBuscadorAbierto(false), []);
    const reintentar = useCallback(() => void recargar(), [recargar]);
    const verVencenHoy = useCallback(() => {
        setPestana('hoy');
        const el = agendaRef.current;
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    const bloque = (id: BloqueId): React.ReactNode => {
        switch (id) {
            case 'B5':
                return <GestionesSerieCard datos={datos} cargando={cargando} onReintentar={reintentar} />;
            case 'B6':
                return <RetomarCard datos={datos} cargando={cargando} onReintentar={reintentar} onBuscar={abrirBuscador} puedeBuscar={puedeBuscar(tienePermiso)} />;
            case 'B7':
                return (
                    <Box ref={agendaRef} sx={{ scrollMarginTop: 80 }}>
                        <AgendaCard datos={datos} cargando={cargando} onReintentar={reintentar} pestana={pestana} onPestana={setPestana} />
                    </Box>
                );
            case 'B8':
                return <ImportacionesCard enCurso={enCursoPropias} terminadas={terminadasHoy} />;
            case 'B9':
                return <ActividadCard deTodos={tienePermiso('auditoria.ver_todos')} pulso={pulso} />;
            case 'B10':
                return <ReportesCard datos={datos} cargando={cargando} onReintentar={reintentar} recargar={recargar} />;
            default:
                return null;
        }
    };

    const columna = (ids: BloqueId[]) => (
        <Stack spacing={3} sx={{ minWidth: 0 }}>
            {ids.map((id) => (
                <React.Fragment key={id}>{bloque(id)}</React.Fragment>
            ))}
        </Stack>
    );

    return (
        <PageContainer>
            <Stack spacing={3}>
                <SaludoBuscador datos={datos} abierto={buscadorAbierto} onAbrir={abrirBuscador} onCerrar={cerrarBuscador} />

                {fallo && datos && (
                    <Alert
                        severity="warning"
                        variant="outlined"
                        action={
                            <Button color="inherit" size="small" onClick={reintentar}>
                                Reintentar
                            </Button>
                        }
                    >
                        No se pudo actualizar. Lo que ves es de la última vez que cargó.
                    </Alert>
                )}

                {visibles.B4 && <TuDiaKpis datos={datos} cargando={cargando} tiene={tienePermiso} onReintentar={reintentar} onVerVencenHoy={verVencenHoy} />}

                {/* Fase 2 — "La operación" (inicio.ver_equipo). Ver docs/inicio-spec.md §1. */}

                {modo === 'dos' && (
                    <Grid container spacing={3}>
                        <Grid item xs={12} lg={8} sx={{ minWidth: 0 }}>
                            {columna(principal)}
                        </Grid>
                        <Grid item xs={12} lg={4} sx={{ minWidth: 0 }}>
                            {columna(lateral)}
                        </Grid>
                    </Grid>
                )}
                {modo === 'solo-principal' && columna(principal)}
                {modo === 'solo-lateral' && (
                    <Grid container spacing={3}>
                        {lateral.map((id, i) => (
                            // Con una cantidad impar, el último ocupa el ancho entero: no queda media pantalla vacía.
                            <Grid item xs={12} md={i === lateral.length - 1 && lateral.length % 2 === 1 ? 12 : 6} key={id} sx={{ minWidth: 0 }}>
                                {bloque(id)}
                            </Grid>
                        ))}
                    </Grid>
                )}
            </Stack>
        </PageContainer>
    );
};

export default Inicio;
