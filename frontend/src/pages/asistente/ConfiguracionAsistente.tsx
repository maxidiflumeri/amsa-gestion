import React, { useEffect, useMemo, useState } from 'react';
import {
    Box, Button, FormControlLabel, InputAdornment, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, TextField, Typography,
} from '@mui/material';
import { asistenteApi } from '../../api/asistente';
import { SectionCard } from '../../components/ui';
import { useNotify } from '../../hooks/useNotify';
import type { ConfigAsistente, PrecioModelo } from '../../types/asistente';

/** Número escrito por una persona: acepta coma o punto. NaN si está vacío o no es un número. */
export const aNumero = (s: string): number => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));

/** Cuántos decimales tiene el número (lo mismo que mide `maxDecimalPlaces` del backend): `0,050` es 0,05, de 2 decimales. */
const decimalesDe = (n: number): number => {
    const t = String(n);
    const i = t.indexOf('.');
    return i < 0 ? 0 : t.length - i - 1;
};

const CAMPOS_PRECIO: Array<{ clave: 'entrada' | 'salida' | 'cacheEscritura5m' | 'cacheEscritura1h' | 'cacheLectura'; etiqueta: string }> = [
    { clave: 'entrada', etiqueta: 'Entrada' },
    { clave: 'salida', etiqueta: 'Salida' },
    { clave: 'cacheEscritura5m', etiqueta: 'Caché 5 min' },
    { clave: 'cacheEscritura1h', etiqueta: 'Caché 1 h' },
    { clave: 'cacheLectura', etiqueta: 'Lectura de caché' },
];
type ClavePrecio = (typeof CAMPOS_PRECIO)[number]['clave'];
type TextosPrecio = Record<ClavePrecio, string>;

const textosDe = (p: Omit<PrecioModelo, 'umbralLargo' | 'largo'>): TextosPrecio => ({
    entrada: String(p.entrada), salida: String(p.salida), cacheEscritura5m: String(p.cacheEscritura5m),
    cacheEscritura1h: String(p.cacheEscritura1h), cacheLectura: String(p.cacheLectura),
});
const numerosDe = (t: TextosPrecio): Omit<PrecioModelo, 'umbralLargo' | 'largo'> => ({
    entrada: aNumero(t.entrada), salida: aNumero(t.salida), cacheEscritura5m: aNumero(t.cacheEscritura5m),
    cacheEscritura1h: aNumero(t.cacheEscritura1h), cacheLectura: aNumero(t.cacheLectura),
});
const validoPrecio = (t: TextosPrecio) => Object.values(numerosDe(t)).every((n) => Number.isFinite(n) && n >= 0);

interface Props {
    config: ConfigAsistente;
    /** Se guardó: la pantalla vuelve a pedir el consumo (una pausa o un tope nuevos cambian lo que muestra). */
    onGuardada: (c: ConfigAsistente) => void;
}

/** Configuración del asistente: interruptor general, topes y precios del modelo en uso (docs/asistente-spec.md §12.3). */
const ConfiguracionAsistente: React.FC<Props> = ({ config, onGuardada }) => {
    const notify = useNotify();
    const precioActual = config.precios?.[config.modelo];

    const [habilitado, setHabilitado] = useState(config.habilitado);
    const [tope, setTope] = useState(String(config.topeMensualUsd));
    const [aviso, setAviso] = useState(String(config.avisoPorcentaje));
    const [limite, setLimite] = useState(String(config.limiteDiarioUsuario));
    const [turno, setTurno] = useState(String(config.topeTurnoUsd));
    const [normal, setNormal] = useState<TextosPrecio | null>(precioActual ? textosDe(precioActual) : null);
    const [largo, setLargo] = useState<TextosPrecio | null>(precioActual?.largo ? textosDe(precioActual.largo) : null);
    const [umbral, setUmbral] = useState(precioActual?.umbralLargo !== undefined ? String(precioActual.umbralLargo) : '');
    const [guardando, setGuardando] = useState(false);

    // Si la configuración cambia desde afuera (se guardó, se recargó), el formulario vuelve a lo que dice el servidor.
    useEffect(() => {
        const p = config.precios?.[config.modelo];
        setHabilitado(config.habilitado);
        setTope(String(config.topeMensualUsd));
        setAviso(String(config.avisoPorcentaje));
        setLimite(String(config.limiteDiarioUsuario));
        setTurno(String(config.topeTurnoUsd));
        setNormal(p ? textosDe(p) : null);
        setLargo(p?.largo ? textosDe(p.largo) : null);
        setUmbral(p?.umbralLargo !== undefined ? String(p.umbralLargo) : '');
    }, [config]);

    const errores = useMemo(() => {
        const e: Record<string, string> = {};
        const t = aNumero(tope), a = aNumero(aviso), l = aNumero(limite), u = aNumero(turno);
        if (!(t >= 0 && t <= 10000)) e.tope = 'Entre 0 y 10.000';
        else if (decimalesDe(t) > 2) e.tope = 'Hasta 2 decimales';
        if (!(Number.isInteger(a) && a >= 10 && a <= 99)) e.aviso = 'Un entero entre 10 y 99';
        if (!(Number.isInteger(l) && l >= 1 && l <= 1000)) e.limite = 'Un entero entre 1 y 1.000';
        if (!(u >= 0.005 && u <= 1)) e.turno = 'Entre 0,005 y 1';
        else if (decimalesDe(u) > 4) e.turno = 'Hasta 4 decimales';
        if (normal && !validoPrecio(normal)) e.precios = 'Todos los precios tienen que ser números de 0 en adelante';
        if (largo && !validoPrecio(largo)) e.precios = 'Todos los precios tienen que ser números de 0 en adelante';
        if (precioActual?.umbralLargo !== undefined && !(Number.isInteger(aNumero(umbral)) && aNumero(umbral) > 0)) e.umbral = 'Un entero mayor que 0';
        return e;
    }, [tope, aviso, limite, turno, normal, largo, umbral, precioActual]);

    const cambios = useMemo(() => {
        const c: Parameters<typeof asistenteApi.actualizarConfig>[0] = {};
        if (habilitado !== config.habilitado) c.habilitado = habilitado;
        if (aNumero(tope) !== config.topeMensualUsd) c.topeMensualUsd = aNumero(tope);
        if (aNumero(aviso) !== config.avisoPorcentaje) c.avisoPorcentaje = aNumero(aviso);
        if (aNumero(limite) !== config.limiteDiarioUsuario) c.limiteDiarioUsuario = aNumero(limite);
        if (aNumero(turno) !== config.topeTurnoUsd) c.topeTurnoUsd = aNumero(turno);
        if (precioActual && normal) {
            const nuevo: PrecioModelo = {
                ...numerosDe(normal),
                ...(precioActual.umbralLargo !== undefined ? { umbralLargo: aNumero(umbral) } : {}),
                ...(precioActual.largo && largo ? { largo: numerosDe(largo) } : {}),
            };
            if (JSON.stringify(nuevo) !== JSON.stringify(precioActual)) c.precios = { ...config.precios, [config.modelo]: nuevo };
        }
        return c;
    }, [habilitado, tope, aviso, limite, turno, normal, largo, umbral, config, precioActual]);

    const hayCambios = Object.keys(cambios).length > 0;
    const hayErrores = Object.keys(errores).length > 0;

    const guardar = async () => {
        setGuardando(true);
        try {
            const nueva = await asistenteApi.actualizarConfig(cambios);
            notify.success('Configuración del asistente guardada');
            onGuardada(nueva);
        } catch (e) {
            notify.error(e as Error);
        } finally {
            setGuardando(false);
        }
    };

    const campo = (etiqueta: string, valor: string, set: (v: string) => void, clave: string, ayuda: string, adorno: 'USD' | '%' | '') => (
        <TextField
            label={etiqueta}
            value={valor}
            onChange={(e) => set(e.target.value)}
            size="small"
            error={!!errores[clave]}
            helperText={errores[clave] ?? ayuda}
            inputProps={{ inputMode: 'decimal' }}
            InputProps={adorno ? { endAdornment: <InputAdornment position="end">{adorno}</InputAdornment> } : undefined}
            fullWidth
        />
    );

    const tablaPrecios = (titulo: string, t: TextosPrecio, set: (t: TextosPrecio) => void) => (
        <TableRow key={titulo}>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{titulo}</TableCell>
            {CAMPOS_PRECIO.map((c) => (
                <TableCell key={c.clave}>
                    <TextField
                        size="small"
                        value={t[c.clave]}
                        onChange={(e) => set({ ...t, [c.clave]: e.target.value })}
                        inputProps={{ 'aria-label': `${titulo}: ${c.etiqueta}`, inputMode: 'decimal' }}
                        sx={{ minWidth: 88 }}
                    />
                </TableCell>
            ))}
        </TableRow>
    );

    return (
        <SectionCard title="Configuración" subtitle="Los cambios rigen desde que se guardan.">
            <Stack spacing={2.5}>
                <FormControlLabel
                    control={<Switch checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} />}
                    label={habilitado ? 'El asistente está activo para todos' : 'El asistente está pausado para todos'}
                />
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
                    {campo('Tope mensual', tope, setTope, 'tope', 'Al llegar, el asistente se pausa para todos hasta el mes siguiente.', 'USD')}
                    {campo('Avisar al llegar a', aviso, setAviso, 'aviso', 'Porcentaje del tope en que se avisa a quienes administran el asistente.', '%')}
                    {campo('Preguntas por persona por día', limite, setLimite, 'limite', 'Protege de bucles; no es un cupo para repartir.', '')}
                    {campo('Tope por pregunta', turno, setTurno, 'turno', 'Gasto máximo de una sola respuesta. Corta las que se descontrolan.', 'USD')}
                </Box>

                <Box>
                    <Typography variant="subtitle2" gutterBottom>Precios del modelo en uso ({config.modelo})</Typography>
                    {normal ? (
                        <>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                USD por millón de tokens. De acá sale el costo de cada respuesta: si un precio está mal, todo el consumo está mal.
                            </Typography>
                            <TableContainer>
                                <Table size="small" aria-label="Precios del modelo">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell />
                                            {CAMPOS_PRECIO.map((c) => <TableCell key={c.clave}>{c.etiqueta}</TableCell>)}
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {tablaPrecios('Normal', normal, setNormal)}
                                        {largo && tablaPrecios('Prompt largo', largo, setLargo)}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                            {precioActual?.umbralLargo !== undefined && (
                                <TextField
                                    sx={{ mt: 1.5, maxWidth: '100%' }}
                                    size="small"
                                    label="Se cobra como largo a partir de (tokens)"
                                    value={umbral}
                                    onChange={(e) => setUmbral(e.target.value)}
                                    error={!!errores.umbral}
                                    helperText={errores.umbral}
                                    inputProps={{ inputMode: 'numeric' }}
                                    fullWidth
                                />
                            )}
                            {errores.precios && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>{errores.precios}</Typography>}
                        </>
                    ) : (
                        <Typography variant="body2" color="text.secondary">
                            Este modelo usa los precios que trae el sistema; no hay una tabla propia para editar.
                        </Typography>
                    )}
                </Box>

                <Stack direction="row" justifyContent="flex-end">
                    <Button variant="contained" onClick={() => void guardar()} disabled={!hayCambios || hayErrores || guardando}>
                        {guardando ? 'Guardando…' : 'Guardar'}
                    </Button>
                </Stack>
            </Stack>
        </SectionCard>
    );
};

export default ConfiguracionAsistente;
