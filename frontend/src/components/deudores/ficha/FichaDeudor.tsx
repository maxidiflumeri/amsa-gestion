import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Box,
    Card,
    Grid,
    Tab,
    Tabs,
} from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import ReceiptIcon from '@mui/icons-material/Receipt';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import HandshakeIcon from '@mui/icons-material/Handshake';
import PeopleAltIcon from '@mui/icons-material/PeopleAlt';

import api from '../../../api/axios';
import { useNotify } from '../../../hooks/useNotify';
import { useConfirm } from '../../../context/ConfirmContext';
import { useAuth } from '../../../context/AuthContext';
import { LoadingSkeleton } from '../../ui';

import TabPanel from './shared/TabPanel';
import FichaHeader from './FichaHeader';
import FichaEstadosCard from './FichaEstadosCard';
import FichaContactosPanel from './FichaContactosPanel';
import FichaComentariosTab from './tabs/FichaComentariosTab';
import FichaFacturasTab from './tabs/FichaFacturasTab';
import FichaPagosTab from './tabs/FichaPagosTab';
import FichaConveniosTab from './tabs/FichaConveniosTab';
import FichaOtrasCuentasTab from './tabs/FichaOtrasCuentasTab';
import AgregarContactoModal from './modals/AgregarContactoModal';
import NuevoConvenioModal from './modals/NuevoConvenioModal';
import PagoCuotaModal from './modals/PagoCuotaModal';
import NuevoPagoModal from './modals/NuevoPagoModal';
import EnviarEmailDialog from '../../email/EnviarEmailDialog';

interface Props {
    deudorId: number;
}

const FichaDeudor: React.FC<Props> = ({ deudorId }) => {
    const notify = useNotify();
    const confirm = useConfirm();
    const { tienePermiso } = useAuth();
    const puedeEnviarEmail = tienePermiso('email.enviar');
    const puedeEditarEstado = tienePermiso('deudores.editar_estado');
    const puedeCargarPago = tienePermiso('pagos.crear');
    const puedeEliminarPago = tienePermiso('pagos.eliminar');
    const puedeCrearPromesa = tienePermiso('promesas.crear');
    const puedeVerPromesas = tienePermiso('promesas.ver');
    const puedeCancelarPromesa = tienePermiso('promesas.cancelar');

    const [deudor, setDeudor] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [estadoSituacion, setEstadoSituacion] = useState('');
    const [estadoGestion, setEstadoGestion] = useState('');
    const [motivoNoPago, setMotivoNoPago] = useState('');
    const [estadosSituacion, setEstadosSituacion] = useState<any[] | null>(null);
    const [estadosGestion, setEstadosGestion] = useState<any[] | null>(null);
    const [motivosNoPago, setMotivosNoPago] = useState<any[]>([]);
    const [cambiosPendientes, setCambiosPendientes] = useState(false);

    // Tabs
    const [tabVal, setTabVal] = useState(0);

    // Convenios
    const [convenios, setConvenios] = useState<any[]>([]);
    const [loadingConvenios, setLoadingConvenios] = useState(false);
    const [openModalConvenio, setOpenModalConvenio] = useState(false);

    // Modal pago de cuota
    const [cuotaAPagar, setCuotaAPagar] = useState<any>(null);

    // Pagos / Promesas
    const [openModalPago, setOpenModalPago] = useState(false);
    const [promesas, setPromesas] = useState<any[]>([]);

    // Modal contacto
    const [openModalAgregar, setOpenModalAgregar] = useState(false);
    const [tipoSeleccionado, setTipoSeleccionado] = useState<string>('');

    // Enviar email
    const [openEmailDialog, setOpenEmailDialog] = useState(false);
    const [destinatarioInicial, setDestinatarioInicial] = useState<string | undefined>(undefined);

    // ── Fetches ──────────────────────────────────────────────────────────────────

    const cargarInicial = useCallback(async () => {
        try {
            setLoading(true);
            const deu = await api.get(`/deudores/${deudorId}`);
            setDeudor(deu.data || []);
            setEstadoSituacion(deu.data.estadoSituacion?.clave || '');
            setEstadoGestion(deu.data.estadoGestion?.clave || '');
            setMotivoNoPago(deu.data.motivoNoPago?.clave || '');
            const es = await api.get(`/parametros?grupo=situacion&empresaId=${deu.data.empresaId}&activo=true`);
            setEstadosSituacion(es.data || []);
            const eg = await api.get(`/parametros?grupo=gestion&empresaId=${deu.data.empresaId}&activo=true`);
            setEstadosGestion(eg.data || []);
            const mnp = await api.get(`/parametros?grupo=motivo_no_pago&empresaId=${deu.data.empresaId}&activo=true`);
            setMotivosNoPago(mnp.data || []);
        } catch (e) {
            notify.error(e as Error);
        } finally {
            setLoading(false);
        }
    }, [deudorId]);

    const cargarConvenios = useCallback(async () => {
        setLoadingConvenios(true);
        try {
            const res = await api.get(`/convenios?deudorId=${deudorId}`);
            setConvenios(res.data || []);
        } catch {
            // silencioso
        } finally {
            setLoadingConvenios(false);
        }
    }, [deudorId]);

    const cargarPromesas = useCallback(async () => {
        if (!puedeVerPromesas) return;
        try {
            const res = await api.get(`/promesas?deudorId=${deudorId}`);
            setPromesas(res.data || []);
        } catch {
            // silencioso
        }
    }, [deudorId, puedeVerPromesas]);

    useEffect(() => {
        cargarInicial();
        cargarConvenios();
        cargarPromesas();
    }, [cargarInicial, cargarConvenios, cargarPromesas]);

    // ── Derived state ─────────────────────────────────────────────────────────────

    // Derivar si la cuenta está cancelada (SIT-050) para el modo bloqueado.
    // Esta prop se propaga a todos los componentes hijos que tienen mutaciones.
    const cuentaCancelada = deudor?.estadoSituacion?.clave === 'SIT-050';

    // ── Handlers ──────────────────────────────────────────────────────────────────

    const handleTabChange = useCallback(
        (_: React.SyntheticEvent, val: number) => {
            setTabVal(val);
        },
        [],
    );

    const handleEstadoChange = useCallback(
        (type: 'situacion' | 'gestion' | 'motivoNoPago', value: string) => {
            if (type === 'situacion') setEstadoSituacion(value);
            else if (type === 'gestion') setEstadoGestion(value);
            else setMotivoNoPago(value);
            setCambiosPendientes(true);
        },
        [],
    );

    const handleGuardarEstados = useCallback(async () => {
        // Cancelar a mano deja el caso de solo lectura: se deshabilitan los controles y desaparece la
        // caja de comentarios. Desde la ficha no hay vuelta atrás, así que conviene preguntarlo antes
        // y no descubrirlo después.
        const situacionElegida = estadosSituacion?.find((e: any) => e.clave === estadoSituacion);
        const vaACancelar = situacionElegida?.categoria === 'CANCELADO' && !cuentaCancelada;
        if (vaACancelar) {
            const ok = await confirm({
                title: `Vas a cerrar el caso como "${situacionElegida.descripcion}"`,
                description:
                    'La cuenta queda de solo lectura: no vas a poder dejar comentarios, cargar promesas ni armar ' +
                    'convenios. Desde la ficha no se puede revertir. ¿Seguro?',
                confirmLabel: 'Cerrar el caso',
                confirmColor: 'error',
            });
            if (!ok) return;
        }

        try {
            await api.put(`/deudores/${deudorId}`, {
                estadoSituacionClave: estadoSituacion,
                estadoGestionClave: estadoGestion,
                // `null` y no `undefined`: es lo que le dice al backend "quitá el motivo". Con
                // `undefined` el campo no viajaba y el motivo anterior quedaba pegado al caso.
                motivoNoPagoClave: motivoNoPago || null,
            });
            setCambiosPendientes(false);
            notify.success('Estados actualizados correctamente');
            cargarInicial();
        } catch (err) {
            notify.error(err as Error);
        }
    }, [deudorId, estadoSituacion, estadoGestion, motivoNoPago, cargarInicial, estadosSituacion, cuentaCancelada, confirm]);

    const handleOpenModalAgregar = useCallback((tipo: string) => {
        setTipoSeleccionado(tipo);
        setOpenModalAgregar(true);
    }, []);

    const handleEliminarContacto = useCallback(
        async (contacto: any) => {
            const ok = await confirm({
                title: 'Eliminar contacto',
                description: `¿Estás seguro que querés eliminar "${contacto.valor}"?`,
                confirmLabel: 'Eliminar',
                confirmColor: 'error',
            });
            if (!ok) return;
            try {
                await api.delete(`/contactos/${contacto.id}`, { params: { deudorId } });
                await cargarInicial();
                notify.success('Contacto eliminado correctamente');
            } catch (err) {
                notify.error(err as Error);
            }
        },
        [confirm, deudorId, cargarInicial],
    );

    /**
     * Marca un mail como rebotado (o le saca la marca).
     *
     * `contacto.validado` existía en el modelo y solo lo escribía la UI de teléfonos: una dirección
     * que rebota no se podía señalar de ninguna forma, así que el próximo gestor la volvía a usar.
     */
    const handleToggleMailValido = useCallback(
        async (contacto: any) => {
            const rebota = contacto.validado === false;
            const ok = await confirm({
                title: rebota ? 'Marcar el mail como válido' : 'Marcar el mail como rebotado',
                description: rebota
                    ? `¿Sacarle la marca de rebote a "${contacto.valor}"?`
                    : `"${contacto.valor}" va a quedar señalado como que rebota, para que nadie más pierda tiempo con él. No se borra.`,
                confirmLabel: rebota ? 'Marcar válido' : 'Marcar rebotado',
            });
            if (!ok) return;
            try {
                await api.put(`/contactos/${contacto.id}`, { validado: rebota });
                notify.success(rebota ? 'Mail marcado como válido' : 'Mail marcado como rebotado');
                cargarInicial();
            } catch (err) {
                notify.error(err as Error);
            }
        },
        [confirm, notify, cargarInicial],
    );

    const handleToggleWhatsapp = useCallback(
        async (contacto: any) => {
            const yaEsWhatsapp = contacto.whatsapp === true || contacto.tipo === 'whatsapp';
            const ok = await confirm({
                title: yaEsWhatsapp ? 'Quitar WhatsApp' : 'Marcar como WhatsApp',
                description: yaEsWhatsapp
                    ? `¿Quitar la marca de WhatsApp del número "${contacto.valor}"?`
                    : `¿Marcar el número "${contacto.valor}" como WhatsApp?`,
                confirmLabel: yaEsWhatsapp ? 'Quitar' : 'Marcar',
            });
            if (!ok) return;
            try {
                const payload: any = { whatsapp: !yaEsWhatsapp };
                if (contacto.tipo === 'whatsapp') payload.tipo = 'telefono';
                await api.put(`/contactos/${contacto.id}`, payload);
                await cargarInicial();
            } catch (err) {
                notify.error(err as Error);
            }
        },
        [cargarInicial, confirm, notify],
    );

    const handleMarcarPrincipal = useCallback(
        async (contacto: any) => {
            const yaEsPrincipal = contacto.prioridad === 1;
            const ok = await confirm({
                title: yaEsPrincipal ? 'Quitar como principal' : 'Marcar como principal',
                description: yaEsPrincipal
                    ? `¿Quitar "${contacto.valor}" como teléfono principal?`
                    : `¿Marcar "${contacto.valor}" como teléfono principal? Si otro teléfono estaba marcado, se desmarcará.`,
                confirmLabel: yaEsPrincipal ? 'Quitar' : 'Marcar',
            });
            if (!ok) return;
            try {
                await api.put(`/contactos/${contacto.id}`, { prioridad: yaEsPrincipal ? null : 1 });
                await cargarInicial();
            } catch (err) {
                notify.error(err as Error);
            }
        },
        [cargarInicial, confirm, notify],
    );

    const handleAnularConvenio = useCallback(
        async (convenioId: number) => {
            try {
                await api.put(`/convenios/${convenioId}/anular`);
                notify.success('Convenio anulado');
                cargarConvenios();
            } catch (err: any) {
                notify.error(err);
            }
        },
        [cargarConvenios],
    );

    const handleAbrirPagarCuota = useCallback((cuota: any) => {
        setCuotaAPagar(cuota);
    }, []);

    const handlePagoCuotaSaved = useCallback(() => {
        cargarConvenios();
        cargarInicial();
    }, [cargarConvenios, cargarInicial]);

    const handleNuevoConvenio = useCallback(() => {
        setOpenModalConvenio(true);
    }, []);

    const handleNuevoPago = useCallback(() => {
        setOpenModalPago(true);
    }, []);

    const handlePagoSaved = useCallback(() => {
        cargarInicial();
        cargarPromesas();
    }, [cargarInicial, cargarPromesas]);

    const handleEliminarPago = useCallback(
        async (pago: any) => {
            const ok = await confirm({
                title: 'Eliminar pago',
                description: `¿Eliminar el pago de $${(pago.importe ?? 0).toLocaleString('es-AR')}? Se recalculará el saldo y la situación del deudor.`,
                confirmLabel: 'Eliminar',
                confirmColor: 'error',
            });
            if (!ok) return;
            try {
                await api.delete(`/pagos/${pago.id}`);
                notify.success('Pago eliminado');
                await cargarInicial();
                await cargarPromesas();
            } catch (err: any) {
                notify.error(err);
            }
        },
        [confirm, notify, cargarInicial, cargarPromesas],
    );

    const handleAnularPromesa = useCallback(
        async (promesa: any) => {
            const ok = await confirm({
                title: 'Anular promesa',
                description: `¿Anular la promesa de pago del ${new Date(promesa.fechaPromesa).toLocaleDateString()}?`,
                confirmLabel: 'Anular',
                confirmColor: 'error',
            });
            if (!ok) return;
            try {
                await api.patch(`/promesas/${promesa.id}/anular`);
                notify.success('Promesa anulada');
                await cargarInicial();
                await cargarPromesas();
            } catch (err: any) {
                notify.error(err);
            }
        },
        [confirm, notify, cargarInicial, cargarPromesas],
    );

    const handleEnviarEmail = useCallback((contacto: any) => {
        setDestinatarioInicial(contacto?.valor);
        setOpenEmailDialog(true);
    }, []);

    // ── Render ────────────────────────────────────────────────────────────────────

    if (loading || !deudor) {
        return (
            <Box sx={{ p: 3 }}>
                <LoadingSkeleton variant="detail" />
            </Box>
        );
    }

    const { comentarios, contactos, facturas, pagos, campoExtras, camposAdicionales, documento } = deudor;

    return (
        <Box sx={{ pb: 4 }}>
            {/* CABECERA */}
            <FichaHeader
                deudor={deudor}
                cuentaCancelada={cuentaCancelada}
            />

            <Grid container spacing={3}>
                {/* COLUMNA IZQUIERDA */}
                <Grid item xs={12} md={7}>
                    {/* ESTADOS */}
                    <FichaEstadosCard
                        estadoSituacion={estadoSituacion}
                        estadoGestion={estadoGestion}
                        motivoNoPago={motivoNoPago}
                        estadosSituacion={estadosSituacion}
                        estadosGestion={estadosGestion}
                        motivosNoPago={motivosNoPago}
                        cambiosPendientes={cambiosPendientes}
                        onEstadoChange={handleEstadoChange}
                        onGuardar={handleGuardarEstados}
                        disabled={cuentaCancelada}
                        puedeEditar={puedeEditarEstado}
                    />

                    {/* TABS DASHBOARD */}
                    <Card elevation={2} sx={{ borderRadius: 3, minHeight: 400 }}>
                        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
                            <Tabs
                                value={tabVal}
                                onChange={handleTabChange}
                                variant="scrollable"
                                scrollButtons="auto"
                                allowScrollButtonsMobile
                                textColor="primary"
                                indicatorColor="primary"
                            >
                                <Tab icon={<ChatIcon fontSize="small" />} iconPosition="start" label="Comentarios" />
                                <Tab
                                    icon={<ReceiptIcon fontSize="small" />}
                                    iconPosition="start"
                                    label={`Facturas (${facturas?.length || 0})`}
                                />
                                <Tab
                                    icon={<AccountBalanceWalletIcon fontSize="small" />}
                                    iconPosition="start"
                                    label={`Pagos (${pagos?.length || 0})`}
                                />
                                <Tab
                                    icon={<HandshakeIcon fontSize="small" />}
                                    iconPosition="start"
                                    label={`Convenios (${convenios.length})`}
                                />
                                <Tab
                                    icon={<PeopleAltIcon fontSize="small" />}
                                    iconPosition="start"
                                    label="Otras Cuentas"
                                />
                            </Tabs>
                        </Box>

                        <TabPanel value={tabVal} index={0}>
                            <FichaComentariosTab
                                deudorId={deudorId}
                                comentarios={comentarios || []}
                                onCreated={cargarInicial}
                                disabled={cuentaCancelada}
                            />
                        </TabPanel>

                        <TabPanel value={tabVal} index={1}>
                            <FichaFacturasTab facturas={facturas || []} />
                        </TabPanel>

                        <TabPanel value={tabVal} index={2}>
                            <FichaPagosTab
                                pagos={pagos || []}
                                promesas={promesas}
                                onCargar={handleNuevoPago}
                                onEliminar={handleEliminarPago}
                                onAnularPromesa={handleAnularPromesa}
                                puedeCargar={puedeCargarPago}
                                puedeEliminar={puedeEliminarPago}
                                puedeCancelarPromesa={puedeCancelarPromesa}
                                disabled={cuentaCancelada}
                            />
                        </TabPanel>

                        <TabPanel value={tabVal} index={3}>
                            <FichaConveniosTab
                                convenios={convenios}
                                loading={loadingConvenios}
                                onNuevoConvenio={handleNuevoConvenio}
                                onAnular={handleAnularConvenio}
                                onPagarCuota={handleAbrirPagarCuota}
                                disabled={cuentaCancelada}
                            />
                        </TabPanel>

                        {/* Tab 4: mantiene hidden (no desmonta) para que FichaOtrasCuentasTab
                            gestione su propio fetch con el guard active */}
                        <div
                            role="tabpanel"
                            hidden={tabVal !== 4}
                            id="fichatabpanel-4"
                            aria-labelledby="fichatab-4"
                        >
                            <Box sx={{ pt: 2 }}>
                                <FichaOtrasCuentasTab
                                    deudorId={deudorId}
                                    documento={documento || ''}
                                    active={tabVal === 4}
                                />
                            </Box>
                        </div>
                    </Card>
                </Grid>

                {/* COLUMNA DERECHA */}
                <Grid item xs={12} md={5}>
                    <FichaContactosPanel
                        contactos={contactos || []}
                        campoExtras={campoExtras || []}
                        camposAdicionales={camposAdicionales || {}}
                        onAgregar={handleOpenModalAgregar}
                        onEliminar={handleEliminarContacto}
                        onToggleWhatsapp={handleToggleWhatsapp}
                        onMarcarPrincipal={handleMarcarPrincipal}
                        onEnviarEmail={handleEnviarEmail}
                        onToggleMailValido={handleToggleMailValido}
                        puedeEnviarEmail={puedeEnviarEmail}
                        disabled={cuentaCancelada}
                    />
                </Grid>
            </Grid>

            {/* MODALES */}
            <AgregarContactoModal
                open={openModalAgregar}
                tipoSeleccionado={tipoSeleccionado}
                deudorId={deudorId}
                onClose={() => setOpenModalAgregar(false)}
                onSaved={cargarInicial}
            />

            <NuevoConvenioModal
                open={openModalConvenio}
                deudorId={deudorId}
                montoSugerido={deudor.montoTotal || 0}
                onClose={() => setOpenModalConvenio(false)}
                onSaved={cargarConvenios}
            />

            <PagoCuotaModal
                cuota={cuotaAPagar}
                onClose={() => setCuotaAPagar(null)}
                onSaved={handlePagoCuotaSaved}
            />

            <NuevoPagoModal
                open={openModalPago}
                deudorId={deudorId}
                saldoSugerido={deudor.saldo ?? deudor.montoTotal ?? 0}
                maxDiasPromesa={deudor.empresa?.configuracion?.promesa_pago?.maxDias ?? 7}
                puedePromesa={puedeCrearPromesa}
                onClose={() => setOpenModalPago(false)}
                onSaved={handlePagoSaved}
            />

            {puedeEnviarEmail && openEmailDialog && (
                <EnviarEmailDialog
                    open={openEmailDialog}
                    deudorId={deudorId}
                    empresaId={deudor.empresaId}
                    destinatarioInicial={destinatarioInicial}
                    onClose={() => setOpenEmailDialog(false)}
                />
            )}
        </Box>
    );
};

export default FichaDeudor;
