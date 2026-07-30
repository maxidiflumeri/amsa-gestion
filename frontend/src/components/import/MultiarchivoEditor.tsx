import React, { useMemo } from 'react'
import { Alert, Box, Button, Chip, Stack, TextField, Tooltip, Typography } from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'

/**
 * Editor de la config de una plantilla MULTIARCHIVO.
 *
 * Mismo criterio que {@link MultirregistroEditor}: la estructura (qué archivo es el deudor, cómo se
 * cruzan entre sí, qué significa una baja) la resuelve el backend porque es lógica de negocio; acá
 * se configura el **layout**, que es lo único que el cedente puede mover sin avisar.
 *
 * A diferencia de multirregistro, estos archivos traen encabezado, así que el layout se declara por
 * **nombre de columna** en vez de por índice. Se edita como JSON a propósito: es config técnica que
 * se toca una vez al dar de alta la cartera. El botón de preset deja el layout de TCFA listo.
 */

/**
 * Layout del paquete diario de Toyota TCFA.
 *
 * ⚠️ Tiene que quedar igual a `backend/src/modules/imports/plantillas/toyota-tcfa.ts`. Está duplicado
 * a propósito (mismo trato que el preset de la cuenta 87): el front necesita poder ofrecerlo sin
 * pedirlo al backend, y lo que manda en producción es lo que quede guardado en la plantilla.
 */
export const PRESET_TOYOTA_TCFA = {
    encoding: 'latin1',
    tieneHeader: true,
    archivos: {
        deudores: '^Deudores',
        detalle: '^DetalleDeuda',
        bajas: '^Bajas',
        codeudores: '^CoDeudores',
    },
    deudores: {
        claveAsignacion: 'IdAsignacion',
        nroCliente: 'cliente',
        nombre: 'nombre',
        documento: 'codfiscal',
        // Va como contacto de tipo `direccion`. Declarado por partes para que Georef pueda
        // filtrar por localidad y provincia si la remesa pide validar domicilios.
        domicilio: {
            calle: 'calle',
            numero: 'numero',
            piso: 'piso',
            departamento: 'departamento',
            cp: 'codpostal',
            localidad: 'ciudad',
            provincia: 'provincia',
        },
        email: 'email',
        codArea: 'ddd',
        telefonos: ['telefono1', 'telefono2'],
        montoTotal: 'TotalDeuda',
        adicionales: {
            cp: 'codpostal',
            localidad: 'ciudad',
            provincia: 'provincia',
            tipo_persona: 'tipopersona',
            tipo_documento: 'tipocodfiscal',
            cond_iva: 'ivacond',
            fecha_asignacion: 'FechaAsignacion',
            cuotas_vencidas: 'CuotasVencidas',
            dias_mora_max: 'DiasMoraMax',
            total_declarado: 'TotalDeuda',
        },
    },
    detalle: {
        claveAsignacion: 'IdAsignacion',
        contrato: 'contrato',
        cuota: 'cuota',
        vencimiento: 'FehcaVto',
        conceptosImporte: {
            Capital: 'capital',
            Interés: 'interes',
            Gastos: 'gastos',
            'Gastos eventuales': 'gas_even',
            ITF: 'itf',
            Seguro: 'seg',
            'Seguro de vida': 'sev',
            IVA: 'iva',
            'Interés moratorio': 'int_mor',
            'Interés punitorio': 'int_pun',
            'IVA mora/punitorios': 'iva_mor_pun',
        },
        adicionales: {
            'Saldo contrato': 'saldocontrato',
            Débito: 'Debito',
            Score: 'IdNameScore',
        },
    },
    // ⚠️ Apagado a propósito: desasignar saca de gestión a todos los casos que dejen de venir.
    // Activarlo recién cuando el cedente confirme que el archivo trae siempre la cartera entera.
    accionAusente: 'IGNORAR',

    bajas: {
        nroCliente: 'cliente',
        contrato: 'contrato',
        cuota: 'cuota',
        fecha: 'FechaFinGestion',
        motivo: 'Motivo',
        motivoId: 'IDMotivo',
        motivosPagoIds: ['1'],
        motivosPago: ['Pago de Cuota'],
    },
    codeudores: {
        titular: 'ClienteTitular',
        nroCodeudor: 'ClienteCoDeudor',
        nombre: 'nombre',
        documento: 'CodFiscal',
        domicilio: {
            calle: 'calle',
            numero: 'numero',
            piso: 'piso',
            departamento: 'departamento',
            cp: 'codpostal',
            localidad: 'ciudad',
            provincia: 'Provincia',
        },
        email: 'email',
        codArea: 'ddd',
        telefonos: ['telefono1', 'telefono2'],
        adicionales: {
            cp: 'codpostal',
            localidad: 'ciudad',
            provincia: 'Provincia',
            tipo_persona: 'TipoPersona',
            tipo_documento: 'TipoCodFiscal',
            cond_iva: 'ivacond',
        },
    },
}

interface Props {
    value: string
    onChange: (v: string) => void
    /** Separador elegido arriba, en "Formato / Separador". El parser usa ese, no uno fijo. */
    separador: string
    /** Deja el separador correcto al aplicar un preset. */
    onSeparadorChange: (v: string) => void
}

/** Separador que usan los archivos de TCFA. */
const SEPARADOR_TCFA = ';'

export default function MultiarchivoEditor({ value, onChange, separador, onSeparadorChange }: Props) {
    const presetJson = JSON.stringify(PRESET_TOYOTA_TCFA, null, 2)
    const yaEsTcfa = value.trim() === presetJson.trim() && separador === SEPARADOR_TCFA

    const { error, aviso, resumen } = useMemo(() => {
        if (!value.trim()) return { error: 'Falta la configuración del layout.', aviso: null, resumen: null }
        try {
            const cfg = JSON.parse(value)
            const faltan: string[] = []
            if (!cfg.archivos?.deudores || !cfg.archivos?.detalle) {
                faltan.push('archivos (patrones de nombre de deudores y detalle)')
            }
            if (!cfg.deudores?.claveAsignacion || !cfg.deudores?.nroCliente) {
                faltan.push('deudores (claveAsignacion y nroCliente)')
            }
            if (!cfg.detalle?.claveAsignacion || !cfg.detalle?.contrato || !cfg.detalle?.cuota) {
                faltan.push('detalle (claveAsignacion, contrato y cuota)')
            }
            if (!cfg.detalle?.conceptosImporte || Object.keys(cfg.detalle.conceptosImporte).length === 0) {
                faltan.push('detalle.conceptosImporte (las columnas que se suman para el importe de la cuota)')
            }
            if (faltan.length) return { error: `Falta configurar: ${faltan.join(', ')}`, aviso: null, resumen: null }

            // Sin motivos declarados el backend usa un default para decidir qué baja es un cobro.
            // Una plantilla sin esta lista ya hizo que una baja por pago se anulara en la cuenta 87.
            const tieneMotivos =
                Array.isArray(cfg.bajas?.motivosPagoIds) || Array.isArray(cfg.bajas?.motivosPago)
            return {
                error: null,
                aviso: cfg.bajas && !tieneMotivos
                    ? 'La config de bajas no declara "motivosPagoIds" ni "motivosPago": el backend va a usar un default para decidir qué bajas son un cobro. Conviene poner los códigos exactos que usa el cedente.'
                    : null,
                resumen: {
                    archivos: Object.keys(cfg.archivos ?? {}),
                    encoding: cfg.encoding ?? 'latin1',
                    conceptos: Object.keys(cfg.detalle?.conceptosImporte ?? {}).length,
                    motivosPagoIds: cfg.bajas?.motivosPagoIds as string[] | undefined,
                    desasigna: cfg.accionAusente === 'DESASIGNAR',
                },
            }
        } catch (e: any) {
            return { error: `JSON inválido: ${e.message}`, aviso: null, resumen: null }
        }
    }, [value, separador])

    return (
        <Box>
            <Alert severity={yaEsTcfa ? 'success' : 'info'} sx={{ mb: 2 }}>
                {yaEsTcfa ? (
                    <>
                        <strong>Listo para Toyota TCFA: no hace falta tocar nada.</strong> El layout de abajo ya
                        viene cargado y el separador está en “;”. Solo completá el nombre y los estados
                        iniciales, y guardá.
                    </>
                ) : (
                    <>
                        Esta categoría es para carteras que llegan como <strong>varios archivos que se cargan
                        juntos</strong> (deudores, detalle de deuda, bajas y codeudores). El backend ya sabe cómo
                        se cruzan entre sí; acá solo se indica <strong>cómo se llama cada columna</strong> y qué
                        patrón de nombre tiene cada archivo, para poder corregirlo si el cedente mueve algo.
                    </>
                )}
            </Alert>

            <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
                <Tooltip
                    title={
                        yaEsTcfa
                            ? 'Ya está aplicado: el layout y el separador coinciden con los de Toyota TCFA'
                            : 'Reemplaza el layout de abajo y pone el separador en ";"'
                    }
                >
                    <span>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<AutoFixHighIcon />}
                            disabled={yaEsTcfa}
                            onClick={() => {
                                onChange(presetJson)
                                onSeparadorChange(SEPARADOR_TCFA)
                            }}
                        >
                            {yaEsTcfa ? 'Layout de Toyota TCFA aplicado' : 'Restaurar layout de Toyota TCFA'}
                        </Button>
                    </span>
                </Tooltip>
                {resumen && (
                    <>
                        <Typography variant="caption" color="text.secondary">Archivos:</Typography>
                        {resumen.archivos.map((a: string) => (
                            <Chip key={a} label={a} size="small" variant="outlined" />
                        ))}
                        <Chip label={resumen.encoding} size="small" />
                        <Chip label={`${resumen.conceptos} conceptos de importe`} size="small" variant="outlined" />
                        <Chip
                            label={`separador: ${separador === '\t' ? 'TAB' : separador}`}
                            size="small"
                            color={separador === SEPARADOR_TCFA ? 'default' : 'warning'}
                        />
                        {resumen.motivosPagoIds && (
                            <Chip
                                label={`bajas por pago: motivo ${resumen.motivosPagoIds.join(', ') || 'ninguno'}`}
                                size="small"
                                variant="outlined"
                            />
                        )}
                        <Chip
                            label={resumen.desasigna ? 'ausentes: DESASIGNA' : 'ausentes: no se tocan'}
                            size="small"
                            color={resumen.desasigna ? 'error' : 'default'}
                        />
                    </>
                )}
            </Stack>

            {aviso && <Alert severity="warning" sx={{ mb: 2 }}>{aviso}</Alert>}

            {/* La desasignación de ausentes es lo más destructivo de esta carga: se avisa aparte y
                fuerte, porque queda escondida en una línea del JSON de abajo. */}
            {resumen?.desasigna && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    <strong>Los casos que dejen de venir en el archivo se van a sacar de gestión</strong>{' '}
                    (Desasignado, GES-094). Es reversible —vuelven solos si reaparecen— y no toca deuda ni
                    pagos, pero si algún día el cedente manda el archivo <strong>incompleto</strong>, sale de
                    gestión toda la cartera que falte. Dejalo en <code>"accionAusente": "IGNORAR"</code>{' '}
                    mientras no tengas confirmado que el archivo trae <strong>siempre</strong> la cartera entera.
                </Alert>
            )}

            <TextField
                label="Layout del paquete (JSON)"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                multiline
                minRows={16}
                fullWidth
                error={!!error}
                helperText={
                    error ??
                    'Las columnas se declaran por nombre, tal como figuran en el encabezado del archivo (no distingue mayúsculas).'
                }
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
            />

            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
                <strong>archivos</strong>: cómo se reconoce cada archivo por su nombre. ·{' '}
                <strong>deudores</strong>: la cartera vigente → un caso por fila. ·{' '}
                <strong>detalle</strong>: las cuotas vencidas → una factura por fila, con el importe sumando los
                conceptos declarados. Se cruza con deudores por <strong>claveAsignacion</strong>, nunca por
                cliente: el cedente sigue mandando cuotas de asignaciones viejas. ·{' '}
                <strong>bajas</strong>: dan de baja una cuota; solo los motivos declarados en{' '}
                <strong>motivosPagoIds</strong> registran un pago. ·{' '}
                <strong>codeudores</strong>: se suman como contactos del titular.
            </Typography>
        </Box>
    )
}
