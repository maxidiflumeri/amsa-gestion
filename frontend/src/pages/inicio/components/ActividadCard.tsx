import React, { useEffect, useRef, useState } from 'react';
import { Avatar, ButtonBase, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { auditoriaApi } from '../../../api/auditoria';
import { SectionCard } from '../../../components/ui';
import type { Transaccion } from '../../../types/auditoria';
import { haceCuanto } from '../formato';
import BloqueEstado from './BloqueEstado';

interface Props {
    /** Con `auditoria.ver_todos` se ve la actividad de todos; sin él, la propia (el backend ya acota). */
    deTodos: boolean;
    /** Sube con cada refresco de `mi-dia`: el bloque vuelve a pedir cuando cambia. */
    pulso: number;
}

/** B9. Los últimos 6 eventos de Gestión de la auditoría. */
const ActividadCard: React.FC<Props> = ({ deTodos, pulso }) => {
    const [items, setItems] = useState<Transaccion[] | null>(null);
    const [fallo, setFallo] = useState(false);
    const [intento, setIntento] = useState(0);
    // Cuándo salió el último pedido completo y con qué reintento. El primer `mi-dia` sube `pulso` a los pocos segundos de
    // montar: sin esto, cada vez que se abre Inicio la auditoría se pide dos veces.
    const ultimoPedidoRef = useRef(0);
    const intentoPrevioRef = useRef(intento);

    useEffect(() => {
        const esReintento = intento !== intentoPrevioRef.current;
        intentoPrevioRef.current = intento;
        if (!esReintento && Date.now() - ultimoPedidoRef.current < 30_000) return;
        ultimoPedidoRef.current = Date.now();
        let vigente = true;
        let terminado = false;
        auditoriaApi
            .listar({ limit: 6, orderDir: 'desc', modulo: 'GESTION' })
            .then((r) => {
                if (!vigente) return;
                setItems(r.items);
                setFallo(false);
            })
            .catch(() => {
                if (vigente) setFallo(true);
            })
            .finally(() => {
                terminado = true;
            });
        return () => {
            vigente = false;
            // Cortado antes de responder (el doble montaje del modo estricto): el próximo efecto tiene que volver a pedir.
            if (!terminado) ultimoPedidoRef.current = 0;
        };
    }, [pulso, intento]);

    let cuerpo: React.ReactNode;
    if (items === null && !fallo) cuerpo = <BloqueEstado estado="cargando" />;
    else if (items === null) cuerpo = <BloqueEstado estado="error" onReintentar={() => setIntento((n) => n + 1)} />;
    else if (items.length === 0) cuerpo = <BloqueEstado estado="vacio" vacio="Sin actividad reciente" />;
    else {
        cuerpo = (
            <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {items.map((t) => {
                    const quien = t.usuario?.nombre ?? 'Sistema';
                    return (
                        <li key={t.id}>
                            <ButtonBase
                                component={RouterLink}
                                to="/auditoria"
                                sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', gap: 1.25, textAlign: 'left', px: 1, py: 1, borderRadius: 1.5, '&:hover': { bgcolor: 'action.hover' } }}
                            >
                                <Avatar sx={{ width: 28, height: 28, fontSize: 12, fontWeight: 700, bgcolor: 'action.selected', color: 'text.primary', flex: 'none' }}>
                                    {quien.charAt(0).toUpperCase()}
                                </Avatar>
                                <Stack sx={{ minWidth: 0 }}>
                                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                                        <Typography component="span" variant="body2" fontWeight={600} color="text.primary">
                                            {quien}
                                        </Typography>{' '}
                                        {t.resumen ?? `${t.tipo} ${t.entidad}`}
                                    </Typography>
                                    <Typography variant="caption" color="text.disabled">
                                        {haceCuanto(t.createdAt)}
                                    </Typography>
                                </Stack>
                            </ButtonBase>
                        </li>
                    );
                })}
            </Stack>
        );
    }

    return (
        <SectionCard
            title={deTodos ? 'Actividad reciente' : 'Tu actividad reciente'}
            action={
                <Link component={RouterLink} to="/auditoria" variant="body2" underline="hover" sx={{ pr: 1, pt: 0.5, display: 'inline-block' }}>
                    Auditoría
                </Link>
            }
        >
            {cuerpo}
        </SectionCard>
    );
};

export default ActividadCard;
