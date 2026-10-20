import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, IconButton, LinearProgress, Stack, Switch, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, TextField, Tooltip as MuiTooltip, Typography, useTheme,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { asistenteApi } from '../../api/asistente';
import { PageHeader, SectionCard } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useNotify } from '../../hooks/useNotify';
import type { ConfigAsistente, ConsumoAsistente, DetalleRespuesta as Detalle } from '../../types/asistente';
import DetalleRespuesta from '../../components/asistente/DetalleRespuesta';
import Markdown from '../ayuda/Markdown';
import ConfiguracionAsistente, { aNumero } from './ConfiguracionAsistente';
import TiemposAsistente from './TiemposAsistente';

const usd = (n: number, decimales = 2) => `US$ ${n.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;
const entero = (n: number) => n.toLocaleString('es-AR');
const porcentaje = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })} %`;
const diaCorto = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** `2026-09` → `septiembre de 2026`. */
const mesLegible = (ym: string) => {
    const nombre = MESES[Number(ym.slice(5, 7)) - 1];
    return nombre ? `${nombre} de ${ym.slice(0, 4)}` : ym;
};

const ERROR_CONSUMO = 'No se pudo cargar el consumo del asistente. Probá de nuevo en un rato.';
/** El `mensaje` (o `message`) que mandó el backend; si no hay, o es el genérico en inglés de un 500, un texto en castellano. */
const textoDeErrorConsumo = (e: unknown, porDefecto = ERROR_CONSUMO): string => {
    const datos = (e as { response?: { data?: { mensaje?: string | string[]; message?: string | string[] } } }).response?.data;
    const crudo = datos?.mensaje ?? datos?.message;
    const msg = Array.isArray(crudo) ? crudo[0] : crudo;
    if (typeof msg !== 'string' || msg.trim() === '' || /^internal server error$/i.test(msg.trim())) return porDefecto;
    return msg;
};

const Indicador: React.FC<{ titulo: string; valor: string; detalle?: string; children?: React.ReactNode }> = ({ titulo, valor, detalle, children }) => (
    <SectionCard sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">{titulo}</Typography>
        <Typography variant="h5" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{valor}</Typography>
        {detalle && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{detalle}</Typography>}
        {children}
    </SectionCard>
);

type CambiosFuncion = { habilitada?: boolean; topeMensualUsd?: number | null; topeTurnoUsd?: number | null; limiteDiarioUsuario?: number | null };

/** Un valor editable de una función con su botón de guardar. Vacío = sin valor propio (rige el global). */
const CampoFuncion: React.FC<{
    original: number | null;
    /** «Tope mensual de «X» en USD» */
    etiqueta: string;
    /** «Guardar el tope de «X»» */
    etiquetaGuardar: string;
    entero?: boolean;
    ancho?: number;
    /** Lo que significa dejarlo vacío: «Sin tope» (rige el general) o «Predeterminado» (vuelve al valor de arranque de la función). */
    vacio?: string;
    min?: number;
    max?: number;
    deshabilitado: boolean;
    onGuardar: (v: number | null) => void;
}> = ({ original, etiqueta, etiquetaGuardar, entero: soloEntero = false, ancho = 100, vacio = 'Sin tope', min = 0, max = Infinity, deshabilitado, onGuardar }) => {
    const [texto, setTexto] = useState(original === null ? '' : String(original));
    useEffect(() => setTexto(original === null ? '' : String(original)), [original]);
    const nuevo = texto.trim() === '' ? null : aNumero(texto);
    const valido = nuevo === null || (Number.isFinite(nuevo) && nuevo >= min && nuevo <= max && (!soloEntero || Number.isInteger(nuevo)));
    const cambio = valido && nuevo !== original;
    return (
        <Stack direction="row" spacing={0.5} alignItems="center">
            <TextField
                size="small"
                value={texto}
                placeholder={vacio}
                onChange={(e) => setTexto(e.target.value)}
                error={!valido}
                disabled={deshabilitado}
                inputProps={{ 'aria-label': etiqueta, inputMode: 'decimal' }}
                sx={{ width: ancho }}
            />
            <MuiTooltip title="Guardar">
                <span>
                    <IconButton size="small" aria-label={etiquetaGuardar} disabled={!cambio || deshabilitado} onClick={() => onGuardar(nuevo)}>
                        <SaveIcon fontSize="small" />
                    </IconButton>
                </span>
            </MuiTooltip>
        </Stack>
    );
};

/** Una función del asistente: se puede apagar y limitar por su cuenta (tope del mes, tope por pregunta y pedidos por persona y día). */
const FilaFuncion: React.FC<{
    f: ConsumoAsistente['porFuncion'][number];
    config: ConfigAsistente | null;
    onCambio: () => void;
}> = ({ f, config, onCambio }) => {
    const notify = useNotify();
    const propia = config?.funciones.find((x) => x.clave === f.funcion);
    const [guardando, setGuardando] = useState(false);

    const patch = async (cambios: CambiosFuncion) => {
        setGuardando(true);
        try {
            await asistenteApi.actualizarFuncion(f.funcion, cambios);
            notify.success(`«${f.nombre}» actualizada`);
            onCambio();
        } catch (e) {
            notify.error(e as Error);
        } finally {
            setGuardando(false);
        }
    };
    const sinConfig = !propia || guardando;

    return (
        <TableRow>
            <TableCell>
                {f.nombre}
                {propia?.modelo && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{propia.modelo}</Typography>}
            </TableCell>
            <TableCell align="right">{usd(f.gastoUsd, 4)}</TableCell>
            <TableCell align="right">{entero(f.preguntas)}</TableCell>
            <TableCell>
                <Switch
                    size="small"
                    checked={propia?.habilitada ?? true}
                    disabled={sinConfig}
                    onChange={(e) => void patch({ habilitada: e.target.checked })}
                    inputProps={{ 'aria-label': `Activar «${f.nombre}»` }}
                />
            </TableCell>
            <TableCell>
                <CampoFuncion
                    original={propia?.topeMensualUsd ?? null}
                    etiqueta={`Tope mensual de «${f.nombre}» en USD`}
                    etiquetaGuardar={`Guardar el tope de «${f.nombre}»`}
                    deshabilitado={sinConfig}
                    onGuardar={(v) => void patch({ topeMensualUsd: v })}
                />
            </TableCell>
            <TableCell>
                <CampoFuncion
                    original={propia?.topeTurnoUsd ?? null}
                    etiqueta={`Tope por pregunta de «${f.nombre}» en USD`}
                    etiquetaGuardar={`Guardar el tope por pregunta de «${f.nombre}»`}
                    vacio="Predeterminado"
                    min={0.005}
                    max={2}
                    deshabilitado={sinConfig}
                    onGuardar={(v) => void patch({ topeTurnoUsd: v })}
                />
            </TableCell>
            <TableCell>
                <CampoFuncion
                    original={propia?.limiteDiarioUsuario ?? null}
                    etiqueta={`Límite diario por persona de «${f.nombre}»`}
                    etiquetaGuardar={`Guardar el límite diario de «${f.nombre}»`}
                    entero
                    ancho={90}
                    vacio="Predeterminado"
                    min={1}
                    max={1000}
                    deshabilitado={sinConfig}
                    onGuardar={(v) => void patch({ limiteDiarioUsuario: v })}
                />
            </TableCell>
        </TableRow>
    );
};

/** Las plantillas que armó el asistente: cuántas se mostraron, cuántas se abrieron en el editor y cuántas se guardaron (§12, §14). */
const PlantillasArmadas: React.FC<{ porFuncion: ConsumoAsistente['porFuncion'] }> = ({ porFuncion }) => {
    const filas = porFuncion.filter((f) => f.plantillas);
    if (filas.length === 0) return null;
    return (
        <SectionCard title="Plantillas armadas con el asistente" subtitle="De las que mostró, cuántas se abrieron en el editor y cuántas se guardaron">
            <TableContainer>
                <Table size="small" aria-label="Plantillas armadas con el asistente">
                    <TableHead>
                        <TableRow>
                            <TableCell>Función</TableCell>
                            <TableCell align="right">Mostradas</TableCell>
                            <TableCell align="right">Abiertas</TableCell>
                            <TableCell align="right">Guardadas</TableCell>
                            <TableCell align="right">Guardadas sin cambios</TableCell>
                            <TableCell align="right">Costo por guardada</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {filas.map((f) => {
                            const p = f.plantillas!;
                            return (
                                <TableRow key={f.funcion}>
                                    <TableCell>{f.nombre}</TableCell>
                                    <TableCell align="right">{entero(p.mostradas)}</TableCell>
                                    <TableCell align="right">{entero(p.abiertas)}{p.mostradas > 0 ? ` (${porcentaje((p.abiertas / p.mostradas) * 100)})` : ''}</TableCell>
                                    <TableCell align="right">{entero(p.guardadas)}{p.mostradas > 0 ? ` (${porcentaje((p.guardadas / p.mostradas) * 100)})` : ''}</TableCell>
                                    <TableCell align="right">{p.guardadas > 0 ? porcentaje((p.guardadasSinCambios / p.guardadas) * 100) : '—'}</TableCell>
                                    <TableCell align="right">{p.costoPorGuardada === null ? '—' : usd(p.costoPorGuardada, 4)}</TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        </SectionCard>
    );
};

const AsistenteConsumo: React.FC = () => {
    const theme = useTheme();
    const notify = useNotify();
    // `useNotify` devuelve un objeto nuevo en cada render: si fuera dependencia del efecto, la configuración se pediría sin parar.
    const notifyRef = useRef(notify);
    notifyRef.current = notify;
    const { tienePermiso } = useAuth();
    const puede = tienePermiso('asistente.administrar');
    // El detalle de una 👎 ajena pide los dos permisos (D-2): el de administrar ya lo tiene quien llega acá.
    const puedeVerDetalle = tienePermiso('asistente.ver_detalle');

    const [mes, setMes] = useState('');
    const [consumo, setConsumo] = useState<ConsumoAsistente | null>(null);
    const [config, setConfig] = useState<ConfigAsistente | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [respuestaAbierta, setRespuestaAbierta] = useState<number | null>(null);
    // El detalle de cada 👎 que se pidió: el mensaje y, cuando llegó, su detalle. No depende del interruptor del panel.
    const [detalles, setDetalles] = useState<Record<number, Detalle>>({});
    const [pidiendoDetalle, setPidiendoDetalle] = useState<number | null>(null);

    const alternarDetalle = async (mensajeId: number) => {
        if (detalles[mensajeId]) {
            setDetalles(({ [mensajeId]: _quitado, ...resto }) => resto);
            return;
        }
        setPidiendoDetalle(mensajeId);
        try {
            const d = await asistenteApi.detalleDeMensaje(mensajeId);
            setDetalles((prev) => ({ ...prev, [mensajeId]: d }));
        } catch (e) {
            notifyRef.current.error(textoDeErrorConsumo(e, 'No se pudo cargar el detalle de la respuesta. Probá de nuevo en un rato.'));
        } finally {
            setPidiendoDetalle(null);
        }
    };

    const cargarConsumo = useCallback(async (m: string) => {
        setCargando(true);
        setError(null);
        try {
            setConsumo(await asistenteApi.consumo(m || undefined));
        } catch (e) {
            setError(textoDeErrorConsumo(e));
        } finally {
            setCargando(false);
        }
    }, []);

    const cargarConfig = useCallback(async () => {
        try {
            setConfig(await asistenteApi.config());
        } catch (e) {
            notifyRef.current.error(e as Error);
        }
    }, []);

    useEffect(() => {
        if (!puede) return;
        void cargarConsumo(mes);
    }, [puede, mes, cargarConsumo]);
    useEffect(() => {
        if (puede) void cargarConfig();
    }, [puede, cargarConfig]);

    const alCambiarFuncion = () => { void cargarConfig(); void cargarConsumo(mes); };

    if (!puede) {
        return (
            <>
                <PageHeader title="Consumo del asistente" />
                <Alert severity="error">No tenés permiso para ver el consumo del asistente.</Alert>
            </>
        );
    }

    const tope = consumo?.topeMensualUsd ?? 0;
    const pct = consumo && tope > 0 ? (consumo.gastoUsd / tope) * 100 : 0;
    const aviso = config?.avisoPorcentaje ?? 80;
    const colorBarra = pct >= 100 ? 'error' : pct >= aviso ? 'warning' : 'primary';
    const votos = consumo ? consumo.calidad.positivas + consumo.calidad.negativas : 0;

    return (
        <>
            <PageHeader title="Consumo del asistente" subtitle="Cuánto se gasta en el asistente, quién lo usa y qué respuestas no sirvieron." />

            <Stack spacing={2.5}>
                <Stack direction="row" spacing={2} alignItems="center">
                    <TextField
                        type="month"
                        size="small"
                        label="Mes"
                        value={mes || consumo?.mes || ''}
                        onChange={(e) => setMes(e.target.value)}
                        InputLabelProps={{ shrink: true }}
                    />
                    {cargando && <CircularProgress size={20} aria-label="Cargando" />}
                </Stack>

                {error && (
                    <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void cargarConsumo(mes)}>Reintentar</Button>}>{error}</Alert>
                )}
                {consumo?.pausa && <Alert severity="warning">{consumo.pausa.mensaje}</Alert>}
                {config?.sinAdministradores && (
                    <Alert severity="warning">Nadie tiene el permiso Administrar el asistente: los avisos de consumo no le llegan a nadie.</Alert>
                )}

                {consumo && (
                    <>
                        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
                            <Indicador titulo="Gasto del mes" valor={`${usd(consumo.gastoUsd)} de ${usd(tope)}`} detalle={`${porcentaje(pct)} del tope`}>
                                <LinearProgress
                                    variant="determinate"
                                    value={Math.min(100, pct)}
                                    color={colorBarra}
                                    sx={{ mt: 1, height: 8, borderRadius: 4 }}
                                    aria-label="Gasto del mes sobre el tope"
                                />
                            </Indicador>
                            <Indicador titulo="Proyección a fin de mes" valor={usd(consumo.proyeccionUsd)} detalle="Al ritmo de lo que va del mes" />
                            <Indicador titulo="Preguntas" valor={entero(consumo.totales.preguntas)} detalle={`${entero(consumo.totales.usuarios)} ${consumo.totales.usuarios === 1 ? 'persona' : 'personas'} · ${entero(consumo.totales.llamadas)} llamadas al modelo`} />
                            <Indicador titulo="Costo por pregunta" valor={usd(consumo.totales.costoPorPregunta, 4)} />
                            <Indicador titulo="Respuestas que sirvieron" valor={votos > 0 ? porcentaje((consumo.calidad.positivas / votos) * 100) : 'Sin votos'} detalle={`${entero(consumo.calidad.positivas)} a favor · ${entero(consumo.calidad.negativas)} en contra · ${entero(consumo.calidad.sinCalificar)} sin calificar`} />
                            <Indicador titulo="Tasa de caché" valor={porcentaje(consumo.totales.tasaCache * 100)} detalle="Cuanto más alta, más barato sale cada pregunta" />
                        </Box>

                        <SectionCard title="Por día" subtitle="Gasto en dólares y cantidad de preguntas">
                            {consumo.porDia.length === 0 ? (
                                <Typography variant="body2" color="text.secondary">Todavía no hay preguntas este mes.</Typography>
                            ) : (
                                <Box sx={{ height: 240 }} role="img" aria-label="Gasto y preguntas por día">
                                    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 280, height: 240 }}>
                                        <BarChart data={consumo.porDia} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                            <CartesianGrid stroke={theme.palette.divider} vertical={false} />
                                            <XAxis dataKey="dia" tickFormatter={diaCorto} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} stroke={theme.palette.divider} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
                                            <YAxis yAxisId="usd" orientation="left" width={44} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} stroke={theme.palette.divider} tickLine={false} />
                                            <YAxis yAxisId="preguntas" orientation="right" width={32} allowDecimals={false} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} stroke={theme.palette.divider} tickLine={false} />
                                            <Tooltip
                                                labelFormatter={(d) => diaCorto(String(d))}
                                                formatter={(v, nombre) => [nombre === 'Gasto (USD)' ? usd(Number(v), 4) : entero(Number(v)), nombre]}
                                                contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, color: theme.palette.text.primary }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 12 }} />
                                            <Bar yAxisId="usd" dataKey="gastoUsd" name="Gasto (USD)" fill={theme.palette.primary.main} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                                            <Bar yAxisId="preguntas" dataKey="preguntas" name="Preguntas" fill={theme.palette.secondary.main} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </Box>
                            )}
                        </SectionCard>

                        <SectionCard title="Por función" subtitle="Cada función se puede apagar o limitar por su cuenta">
                            <TableContainer>
                                <Table size="small" aria-label="Consumo por función">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Función</TableCell>
                                            <TableCell align="right">Gasto</TableCell>
                                            <TableCell align="right">Preguntas</TableCell>
                                            <TableCell>Activa</TableCell>
                                            <TableCell>Tope mensual (USD)</TableCell>
                                            <TableCell>Tope por pregunta (USD)</TableCell>
                                            <TableCell>Pedidos por persona y día</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {consumo.porFuncion.map((f) => <FilaFuncion key={f.funcion} f={f} config={config} onCambio={alCambiarFuncion} />)}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </SectionCard>

                        <TiemposAsistente mes={consumo.mes} mesLegible={mesLegible(consumo.mes)} />

                        <PlantillasArmadas porFuncion={consumo.porFuncion} />

                        <SectionCard title="Por persona" subtitle="Las 50 que más gastaron en el mes">
                            {consumo.porUsuario.length === 0 ? (
                                <Typography variant="body2" color="text.secondary">Nadie usó el asistente este mes.</Typography>
                            ) : (
                                <TableContainer>
                                    <Table size="small" aria-label="Consumo por persona">
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Persona</TableCell>
                                                <TableCell align="right">Preguntas</TableCell>
                                                <TableCell align="right">Gasto</TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {consumo.porUsuario.map((u) => (
                                                <TableRow key={u.usuarioId}>
                                                    <TableCell>{u.nombre}</TableCell>
                                                    <TableCell align="right">{entero(u.preguntas)}</TableCell>
                                                    <TableCell align="right">{usd(u.gastoUsd, 4)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            )}
                        </SectionCard>

                        <SectionCard
                            title="Respuestas con 👎"
                            subtitle="Las últimas 20. Son la lista de lo que hay que mejorar en la Documentación."
                            action={<Chip size="small" color={consumo.calidad.sinDocumentar > 0 ? 'warning' : 'default'} label={`No está en la documentación: ${entero(consumo.calidad.sinDocumentar)}`} sx={{ mr: 1, mt: 1 }} />}
                        >
                            {consumo.negativasRecientes.length === 0 ? (
                                <Typography variant="body2" color="text.secondary">Ninguna respuesta con 👎 en {mesLegible(consumo.mes)}.</Typography>
                            ) : (
                                <Stack spacing={1.5} divider={<Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />}>
                                    {consumo.negativasRecientes.map((n) => {
                                        const abierta = respuestaAbierta === n.mensajeId;
                                        return (
                                            <Box key={n.mensajeId} sx={{ minWidth: 0 }}>
                                                <Typography variant="caption" color="text.secondary">{fechaHora(n.fecha)} · {n.usuario}</Typography>
                                                <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{n.pregunta}</Typography>
                                                <Box data-testid="respuesta-negativa" sx={{ color: 'text.secondary', overflowWrap: 'anywhere', ...(abierta ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>
                                                    <Markdown texto={n.respuesta} compacto />
                                                </Box>
                                                <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
                                                    <Button size="small" onClick={() => setRespuestaAbierta(abierta ? null : n.mensajeId)}>{abierta ? 'Ver menos' : 'Ver completa'}</Button>
                                                    {puedeVerDetalle && (
                                                        <Button size="small" disabled={pidiendoDetalle === n.mensajeId} onClick={() => void alternarDetalle(n.mensajeId)}>
                                                            {detalles[n.mensajeId] ? 'Ocultar detalle' : 'Ver detalle'}
                                                        </Button>
                                                    )}
                                                </Stack>
                                                {puedeVerDetalle && detalles[n.mensajeId] && <DetalleRespuesta detalle={detalles[n.mensajeId]} abiertoInicial />}
                                                {n.comentario && (
                                                    <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                                                        <strong>Qué faltó:</strong> {n.comentario}
                                                    </Typography>
                                                )}
                                                {n.fuentes.length > 0 && (
                                                    <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.5} sx={{ mt: 0.5 }}>
                                                        {n.fuentes.map((f) => <Chip key={f.slug} size="small" variant="outlined" label={f.titulo} />)}
                                                    </Stack>
                                                )}
                                            </Box>
                                        );
                                    })}
                                </Stack>
                            )}
                        </SectionCard>
                    </>
                )}

                {config && (
                    <ConfiguracionAsistente
                        config={config}
                        onGuardada={(c) => { setConfig(c); void cargarConsumo(mes); }}
                    />
                )}
            </Stack>
        </>
    );
};

export default AsistenteConsumo;
