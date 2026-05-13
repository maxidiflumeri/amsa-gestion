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
import EnviarEmailDialog from '../../email/EnviarEmailDialog';

interface Props {
    deudorId: number;
}

const FichaDeudor: React.FC<Props> = ({ deudorId }) => {
    const notify = useNotify();
    const confirm = useConfirm();
    const { tienePermiso } = useAuth();
    const puedeEnviarEmail = tienePermiso('email.enviar');

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

    useEffect(() => {
        cargarInicial();
        cargarConvenios();
    }, [cargarInicial, cargarConvenios]);

    // ── Derived state ─────────────────────────────────────────────────────────────

    const totalPagadoConvenios = useMemo(
        () =>
            convenios
                .filter((c) => c.estado === 'ACTIVO' || c.estado === 'FINALIZADO')
                .flatMap((c: any) => c.cuotas || [])
                .filter((q: any) => q.estado === 'PAGADA')
                .reduce((sum: number, q: any) => sum + (q.importe || 0), 0),
        [convenios],
    );

    const deudaActualizada = useMemo(
        () => (deudor?.montoTotal || 0) - totalPagadoConvenios,
        [deudor?.montoTotal, totalPagadoConvenios],
    );

    const tieneConveniosPagados = useMemo(() => totalPagadoConvenios > 0, [totalPagadoConvenios]);

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
        try {
            await api.put(`/deudores/${deudorId}`, {
                estadoSituacionClave: estadoSituacion,
                estadoGestionClave: estadoGestion,
                motivoNoPagoClave: motivoNoPago || undefined,
            });
            setCambiosPendientes(false);
            notify.success('Estados actualizados correctamente');
            cargarInicial();
        } catch (err) {
            notify.error(err as Error);
        }
    }, [deudorId, estadoSituacion, estadoGestion, motivoNoPago, cargarInicial]);

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
                deudaActualizada={deudaActualizada}
                totalPagadoConvenios={totalPagadoConvenios}
                tieneConveniosPagados={tieneConveniosPagados}
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
                            />
                        </TabPanel>

                        <TabPanel value={tabVal} index={1}>
                            <FichaFacturasTab facturas={facturas || []} />
                        </TabPanel>

                        <TabPanel value={tabVal} index={2}>
                            <FichaPagosTab pagos={pagos || []} />
                        </TabPanel>

                        <TabPanel value={tabVal} index={3}>
                            <FichaConveniosTab
                                convenios={convenios}
                                loading={loadingConvenios}
                                onNuevoConvenio={handleNuevoConvenio}
                                onAnular={handleAnularConvenio}
                                onPagarCuota={handleAbrirPagarCuota}
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
                        puedeEnviarEmail={puedeEnviarEmail}
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
