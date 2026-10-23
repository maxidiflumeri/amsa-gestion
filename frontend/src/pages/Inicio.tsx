// src/pages/Inicio.tsx — "Tu día" (docs/inicio-spec.md). Cada bloque decide solo por permisos, no por el nombre del rol.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Stack } from '@mui/material';
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
import AvisoInstalar from '../pwa/AvisoInstalar';
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
                    <Box ref={agendaRef} sx={{ scrollMarginTop: { xs: 80, md: 16 } }}>
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

    /** `cual` marca la columna en la grilla de dos (la usan los tests: el layout de CSS grid no deja clases). */
    const columna = (ids: BloqueId[], cual?: 'principal' | 'lateral') => (
        <Stack spacing={3} sx={{ minWidth: 0 }} data-columna={cual}>
            {ids.map((id) => (
                <React.Fragment key={id}>{bloque(id)}</React.Fragment>
            ))}
        </Stack>
    );

    return (
        <PageContainer>
            <Stack spacing={3}>
                <SaludoBuscador datos={datos} abierto={buscadorAbierto} onAbrir={abrirBuscador} onCerrar={cerrarBuscador} />

                {/* Solo en el celular: "Instalá Gestión" (src/pwa/AvisoInstalar.tsx). */}
                <AvisoInstalar />

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

                {/*
                  CSS grid con gap, no <Grid container>: el Grid de MUI se acomoda con un margen negativo que el Stack
                  de arriba pisa con `margin: 0`, y la fila quedaba corrida 24 px a la derecha de las tarjetas de "Tu día".
                */}
                {modo === 'dos' && (
                    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 2fr) minmax(0, 1fr)' } }}>
                        {columna(principal, 'principal')}
                        {columna(lateral, 'lateral')}
                    </Box>
                )}
                {modo === 'solo-principal' && columna(principal)}
                {modo === 'solo-lateral' && (
                    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } }}>
                        {lateral.map((id, i) => (
                            // Con una cantidad impar, el último ocupa el ancho entero: no queda media pantalla vacía.
                            <Box
                                key={id}
                                data-ancho={i === lateral.length - 1 && lateral.length % 2 === 1 ? 'entero' : 'mitad'}
                                sx={{ minWidth: 0, gridColumn: i === lateral.length - 1 && lateral.length % 2 === 1 ? '1 / -1' : undefined }}
                            >
                                {bloque(id)}
                            </Box>
                        ))}
                    </Box>
                )}
            </Stack>
        </PageContainer>
    );
};

export default Inicio;
