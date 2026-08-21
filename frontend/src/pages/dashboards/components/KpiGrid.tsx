import React from 'react';
import { Grid } from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import PaymentsIcon from '@mui/icons-material/Payments';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GroupIcon from '@mui/icons-material/Group';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import HourglassBottomIcon from '@mui/icons-material/HourglassBottom';
import HandshakeIcon from '@mui/icons-material/Handshake';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import BlockIcon from '@mui/icons-material/Block';
import GavelIcon from '@mui/icons-material/Gavel';
import type { SnapshotKpis } from '../../../types/dashboards';
import KpiCard from './KpiCard';
import { fmtDays, fmtMoney, fmtMoneyShort, fmtNumber, fmtPercent } from '../utils';

interface Props {
    kpis: SnapshotKpis;
}

const KpiGrid: React.FC<Props> = ({ kpis }) => {
    return (
        <Grid container spacing={2}>
            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="Cantidad de casos" value={fmtNumber(kpis.cantidadCasos)} icon={<AssignmentIcon />} />
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="Deuda asignada" value={fmtMoneyShort(kpis.deudaAsignada)} hint={`${fmtMoney(kpis.deudaAsignada)} — lo que entró, no baja al cobrar`} icon={<AccountBalanceIcon />} color="primary" />
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="Saldo pendiente" value={fmtMoneyShort(kpis.saldoPendiente)} hint={`${fmtMoney(kpis.saldoPendiente)} — lo que falta cobrar hoy`} icon={<AccountBalanceIcon />} color="warning" />
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="% Recupero acumulado" value={fmtPercent(kpis.recuperoAcumulado)} hint="Todo lo cobrado sobre lo asignado" icon={<TrendingUpIcon />} color="success" />
            </Grid>

            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="Cobrado en el período" value={fmtMoneyShort(kpis.pagosPeriodo)} hint={fmtMoney(kpis.pagosPeriodo)} icon={<PaymentsIcon />} color="success" />
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="Casos con pago (período)" value={fmtNumber(kpis.casosConPago)} hint="Dentro del rango de fechas" icon={<GroupIcon />} />
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="Ticket promedio" value={fmtMoneyShort(kpis.ticketPromedio)} hint={fmtMoney(kpis.ticketPromedio)} icon={<ReceiptLongIcon />} />
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
                {/*
                  Depende de `deudor.fechaVencimiento`, que muchas carteras no traen: sin ese dato el
                  KPI mostraba "—" a secas y parecía un error del tablero.
                */}
                <KpiCard
                    label="Mora promedio"
                    value={fmtDays(kpis.moraPromediaDias)}
                    hint={kpis.moraPromediaDias == null ? 'Esta cartera no trae fecha de vencimiento' : undefined}
                    icon={<HourglassBottomIcon />}
                    color="warning"
                />
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="Promesas vigentes" value={fmtNumber(kpis.promesasVigentes)} icon={<HandshakeIcon />} color="info" />
            </Grid>

            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="% CPC" value={fmtPercent(kpis.porcentajeCpc)} hint="Contacto con persona correcta" icon={<PhoneInTalkIcon />} />
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="Casos sin gestión" value={fmtNumber(kpis.casosSinGestion)} hint="Sin un solo comentario: nadie los trabajó" icon={<HelpOutlineIcon />} color="warning" />
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="Incobrables" value={fmtNumber(kpis.casosIncobrables)} icon={<BlockIcon />} color="error" />
            </Grid>
            <Grid item xs={6} sm={4} md={3}>
                <KpiCard label="En proceso legal" value={fmtNumber(kpis.casosLegales)} icon={<GavelIcon />} color="error" />
            </Grid>
        </Grid>
    );
};

export default KpiGrid;
