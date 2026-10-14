import React from 'react';
import { Box, Chip, Grid, LinearProgress, Step, StepLabel, Stepper, Typography, useMediaQuery, useTheme } from '@mui/material';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import { SectionCard } from '../../ui';
import AvisosCarga from '../AvisosCarga';
import type { EstadoCargaDto } from '../../../types/importProgreso';
import type { ErrorDeCargaDto } from '../../../types/importHistorial';
import {
    barraDeRemesa,
    barraIndeterminada,
    cancelacionPedidaAt,
    casosActualizados,
    casosNuevos,
    datosDeGrupo,
    descartadasPorFiltro,
    esperaAbreviada,
    etiquetaDeEstado,
    etiquetaFase,
    formatearNumero,
    lineaDeRitmo,
    lineaDeUltimoError,
    pasosDeCarga,
    plural,
    remesaActualDelGrupo,
    resumenDeGrupo,
    type PasoDeCarga,
} from '../../../utils/estadoCarga';

// La tarjeta de progreso de una carga (docs/imports-progreso-c2-spec.md §16.3): una sola para el paso "Importando" del asistente,
// el detalle y la campanita. Es presentacional: no pide nada a la API ni escucha el socket; todo le llega por props.

export type VarianteTarjeta = 'completa' | 'detalle' | 'compacta';

export interface UltimosErrores {
    /** Hasta 5, en el orden de la lectura (`orden=desc`). */
    items: ErrorDeCargaDto[];
    /** De toda la carga. null si el backend no los trae. */
    totales: { filas: number; avisos: number } | null;
    /** La última lectura falló (se conservan los items de la anterior). */
    fallo: boolean;
}

export interface TarjetaProgresoProps {
    variante: VarianteTarjeta;
    /** null = todavía no hay estado (recién confirmada): "Enviando a la cola…", barra indeterminada. */
    carga: EstadoCargaDto | null;
    conectado: boolean;
    /** División: las remesas por `grupoOrden`. Con 2 o más se dibuja el bloque de la división. */
    grupo?: EstadoCargaDto[];
    /** `grupoTotal`; si falta, `grupo.length`. */
    totalGrupo?: number;
    /** Corte de cada remesa por `remesaId` (solo el asistente lo tiene). */
    cortes?: Record<number, string>;
    /** Solo completa y detalle. `undefined` = la sección no se dibuja; `null` = todavía no hay lectura. */
    ultimos?: UltimosErrores | null;
    /** El pie: cancelar, "Ver detalle". La tarjeta no decide permisos ni llama a la API. */
    acciones?: React.ReactNode;
    /** Se pasa tal cual a `AvisosCarga`. */
    textoSinConexion?: string;
}

const CHIP_COMPACTO_SX = { height: 18, fontSize: '0.65rem' } as const;

/**
 * Solo el nombre de cada paso: el `detalle` ("Enviando a la cola…", "Hay 1 importación antes que esta.", "43 %") ya lo dice
 * la línea de fase o el porcentaje de la misma tarjeta, y dibujarlo dos veces se leía repetido (auditoría de C2b).
 */
function Pasos({ pasos }: { pasos: PasoDeCarga[] }) {
    const theme = useTheme();
    const celular = useMediaQuery(theme.breakpoints.down('sm'));
    const indice = pasos.findIndex((p) => p.estado === 'actual');
    if (celular) {
        const actual = pasos[indice < 0 ? 0 : indice];
        return (
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere', width: '100%' }}>
                {`Paso ${(indice < 0 ? 0 : indice) + 1} de ${pasos.length} · ${actual.etiqueta}`}
            </Typography>
        );
    }
    return (
        <Stepper alternativeLabel activeStep={indice < 0 ? 0 : indice} sx={{ width: '100%' }}>
            {pasos.map((p) => (
                <Step key={p.clave} completed={p.estado === 'hecho' || (p.clave === 'LISTO' && p.estado === 'actual' && !p.error)}>
                    <StepLabel error={p.error}>{p.etiqueta}</StepLabel>
                </Step>
            ))}
        </Stepper>
    );
}

function Contadores({ carga, compacta }: { carga: EstadoCargaDto; compacta: boolean }) {
    if (compacta) {
        return (
            <>
                <Chip label={`Procesadas: ${formatearNumero(carga.procesadas)}`} size="small" variant="outlined" sx={CHIP_COMPACTO_SX} />
                <Chip label={`OK: ${formatearNumero(carga.ok)}`} size="small" color="success" variant="outlined" sx={CHIP_COMPACTO_SX} />
                {carga.err > 0 && <Chip label={`Err: ${formatearNumero(carga.err)}`} size="small" color="error" variant="outlined" sx={CHIP_COMPACTO_SX} />}
                {carga.totalEsperado > 0 && (
                    <Chip label={`Total: ${formatearNumero(carga.totalEsperado)}`} size="small" variant="outlined" sx={CHIP_COMPACTO_SX} />
                )}
            </>
        );
    }
    const nuevos = casosNuevos(carga);
    const actualizados = casosActualizados(carga);
    const filtro = descartadasPorFiltro(carga);
    const celda = (clave: string, chip: React.ReactNode) => (
        <Grid item xs={6} sm="auto" key={clave} sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>
            {chip}
        </Grid>
    );
    const sx = { maxWidth: '100%' } as const;
    return (
        <Grid container spacing={1} justifyContent="center" sx={{ width: '100%', m: 0 }}>
            {carga.totalEsperado > 0 && celda('total', <Chip label={`Total: ${formatearNumero(carga.totalEsperado)}`} variant="outlined" size="small" sx={sx} />)}
            {celda('procesadas', <Chip label={`Procesadas: ${formatearNumero(carga.procesadas)}`} variant="outlined" size="small" sx={sx} />)}
            {celda('ok', <Chip label={`OK: ${formatearNumero(carga.ok)}`} color="success" variant="outlined" size="small" sx={sx} />)}
            {carga.err > 0 && celda('err', <Chip label={`Errores: ${formatearNumero(carga.err)}`} color="error" variant="outlined" size="small" sx={sx} />)}
            {filtro > 0 && celda('descartadas', <Chip label={`Descartadas: ${formatearNumero(filtro)}`} color="warning" variant="outlined" size="small" sx={sx} />)}
            {nuevos !== null && celda('nuevos', <Chip label={`Nuevos: ${formatearNumero(nuevos)}`} variant="outlined" size="small" sx={sx} />)}
            {actualizados !== null && celda('actualizados', <Chip label={`Actualizados: ${formatearNumero(actualizados)}`} variant="outlined" size="small" sx={sx} />)}
        </Grid>
    );
}

function BloqueGrupo({
    variante,
    grupo,
    totalGrupo,
    cortes,
}: {
    variante: VarianteTarjeta;
    grupo: EstadoCargaDto[];
    totalGrupo?: number;
    cortes?: Record<number, string>;
}) {
    const resumen = resumenDeGrupo(grupo, totalGrupo ?? grupo.length);
    const actual = remesaActualDelGrupo(grupo);
    return (
        <Box sx={{ width: '100%', textAlign: 'left' }}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                {`Remesas terminadas: ${resumen.terminadas} de ${resumen.total}`}
            </Typography>
            <LinearProgress
                variant="determinate"
                value={resumen.porcentaje}
                aria-label="Remesas terminadas"
                sx={{ height: 6, borderRadius: 3, mb: variante === 'completa' ? 1 : 0 }}
            />
            {variante === 'completa' &&
                grupo.map((r) => {
                    const est = etiquetaDeEstado(r);
                    const barra = barraDeRemesa(r);
                    const esActual = actual?.remesaId === r.remesaId;
                    return (
                        <Box key={r.remesaId} sx={{ py: 1, borderTop: 1, borderColor: 'divider' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                <Typography variant="body2" fontWeight={esActual ? 700 : 600}>
                                    Remesa {r.numeroRemesa}
                                </Typography>
                                {cortes?.[r.remesaId] && (
                                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                                        {cortes[r.remesaId]}
                                    </Typography>
                                )}
                                <Box sx={{ flexGrow: 1 }} />
                                <Chip label={est.etiqueta} color={est.color} size="small" variant="outlined" />
                            </Box>
                            <LinearProgress
                                variant={barra.variante}
                                value={barra.variante === 'determinate' ? barra.valor : undefined}
                                aria-label={`Remesa ${r.numeroRemesa}`}
                                sx={{ height: 4, borderRadius: 2, mt: 0.75 }}
                            />
                        </Box>
                    );
                })}
        </Box>
    );
}

function totalesDeUltimos(t: { filas: number; avisos: number }): string | null {
    const partes: string[] = [];
    if (t.filas > 0) partes.push(`${formatearNumero(t.filas)} ${plural(t.filas, 'error de fila', 'errores de fila')}`);
    if (t.avisos > 0) partes.push(`${formatearNumero(t.avisos)} ${plural(t.avisos, 'aviso', 'avisos')}`);
    return partes.length > 0 ? `En total: ${partes.join(' y ')}` : null;
}

function SeccionUltimos({ ultimos }: { ultimos: UltimosErrores }) {
    const total = ultimos.totales ? totalesDeUltimos(ultimos.totales) : null;
    return (
        <Box sx={{ width: '100%', textAlign: 'left' }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Últimos errores y avisos
            </Typography>
            {total && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {total}
                </Typography>
            )}
            {ultimos.items.map((e) => {
                const l = lineaDeUltimoError(e);
                return (
                    <Typography key={e.id} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                        {`${l.rotulo} · ${l.texto}`}
                    </Typography>
                );
            })}
            {ultimos.fallo && ultimos.items.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                    No se pudieron leer los últimos errores.
                </Typography>
            )}
        </Box>
    );
}

export default function TarjetaProgreso({
    variante,
    carga,
    conectado,
    grupo,
    totalGrupo,
    cortes,
    ultimos,
    acciones,
    textoSinConexion,
}: TarjetaProgresoProps) {
    const indeterminada = barraIndeterminada(carga);
    const fase = etiquetaFase(carga, 'wizard');
    const ritmo = carga ? lineaDeRitmo(carga) : null;

    if (variante === 'compacta') {
        if (!carga) return null;
        const espera = carga.fase === 'PROCESANDO' ? esperaAbreviada(carga) : null;
        const datosGrupo = datosDeGrupo(carga);
        const cancelando = cancelacionPedidaAt(carga) !== null;
        return (
            <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, gap: 1 }}>
                    <Typography variant="body2" fontWeight={600} noWrap sx={{ minWidth: 0 }}>
                        {carga.tipo} · Remesa {carga.numeroRemesa}
                        {datosGrupo && datosGrupo.orden != null && datosGrupo.total != null ? ` · ${datosGrupo.orden} de ${datosGrupo.total}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0, maxWidth: { xs: 90, sm: 110 } }}>
                        {carga.usuarioNombre}
                    </Typography>
                </Box>
                <LinearProgress
                    variant={indeterminada ? 'indeterminate' : 'determinate'}
                    value={indeterminada ? undefined : carga.progreso}
                    sx={{ height: 6, borderRadius: 3, mb: 0.75 }}
                />
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="caption" color="text.secondary">
                        {cancelando ? 'Cancelando…' : fase.principal}
                        {!indeterminada ? ` · ${carga.progreso}%` : ''}
                        {espera ? ` · ${espera}` : ''}
                    </Typography>
                    <Contadores carga={carga} compacta />
                    {acciones && (
                        <>
                            <Box sx={{ flexGrow: 1 }} />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>{acciones}</Box>
                        </>
                    )}
                </Box>
                {fase.secundario && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block', overflowWrap: 'anywhere' }}>
                        {fase.secundario}
                    </Typography>
                )}
            </Box>
        );
    }

    const completa = variante === 'completa';
    const pasos = pasosDeCarga(carga);
    const hayGrupo = (grupo?.length ?? 0) >= 2;
    const verUltimos =
        ultimos != null && carga !== null && (carga.err > 0 || (carga.advertencias ?? 0) > 0) && (ultimos.items.length > 0 || ultimos.fallo);

    const cuerpo = (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: completa ? 'center' : 'stretch',
                gap: 2,
                py: completa ? 2 : 0,
                width: '100%',
                textAlign: completa ? 'center' : 'left',
            }}
        >
            {completa && (
                <HourglassTopIcon
                    sx={{
                        fontSize: 48,
                        color: 'primary.main',
                        animation: 'spin 2s linear infinite',
                        '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
                    }}
                />
            )}

            {pasos && <Pasos pasos={pasos} />}

            {completa && !indeterminada && carga && (
                <Typography variant="h4" fontWeight={700} color="primary.main">
                    {carga.progreso}%
                </Typography>
            )}

            <LinearProgress
                variant={indeterminada ? 'indeterminate' : 'determinate'}
                value={indeterminada ? undefined : carga?.progreso ?? 0}
                sx={{ width: '100%', height: 8, borderRadius: completa ? 4 : 1 }}
            />

            {completa && carga && <Contadores carga={carga} compacta={false} />}

            {completa && ritmo && (
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {ritmo}
                </Typography>
            )}

            {completa ? (
                <Box sx={{ maxWidth: '100%' }}>
                    <Typography variant="body1" fontWeight={600}>
                        {fase.principal}
                    </Typography>
                    {fase.secundario && (
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                            {fase.secundario}
                        </Typography>
                    )}
                </Box>
            ) : (
                carga && (
                    <Box>
                        <Typography variant="caption" color="text.secondary" display="block">
                            {fase.principal}
                            {!indeterminada ? ` · ${carga.progreso}% completado` : ''}
                        </Typography>
                        {fase.secundario && (
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ overflowWrap: 'anywhere' }}>
                                {fase.secundario}
                            </Typography>
                        )}
                        {ritmo && (
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ overflowWrap: 'anywhere' }}>
                                {ritmo}
                            </Typography>
                        )}
                    </Box>
                )
            )}

            {hayGrupo && grupo && <BloqueGrupo variante={variante} grupo={grupo} totalGrupo={totalGrupo} cortes={cortes} />}

            {(completa || carga?.enCurso === true) && <AvisosCarga estado={carga} conectado={conectado} textoSinConexion={textoSinConexion} />}

            {verUltimos && ultimos && <SeccionUltimos ultimos={ultimos} />}

            {acciones && <Box sx={{ display: 'flex', justifyContent: completa ? 'center' : 'flex-start', width: '100%' }}>{acciones}</Box>}
        </Box>
    );

    return completa ? <SectionCard sx={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>{cuerpo}</SectionCard> : cuerpo;
}
