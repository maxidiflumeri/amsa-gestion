import React, { useState } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import { PageContainer, PageHeader } from '../../components/ui';
import AuditoriaDashboard from './AuditoriaDashboard';
import AuditoriaStream from './AuditoriaStream';
import AuditoriaBusqueda from './AuditoriaBusqueda';

const AuditoriaPage: React.FC = () => {
    const [tab, setTab] = useState(0);

    return (
        <PageContainer>
            <PageHeader title="Auditoría" subtitle="Trazabilidad de todas las acciones del sistema" />

            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
                <Tab label="Dashboard" />
                <Tab label="Stream" />
                <Tab label="Búsqueda" />
            </Tabs>

            <Box>
                {tab === 0 && <AuditoriaDashboard />}
                {tab === 1 && <AuditoriaStream />}
                {tab === 2 && <AuditoriaBusqueda />}
            </Box>
        </PageContainer>
    );
};

export default AuditoriaPage;
