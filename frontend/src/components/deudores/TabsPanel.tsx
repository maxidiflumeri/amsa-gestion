// src/components/deudores/TabsPanel.tsx
import React from 'react'
import { Tabs, Tab, Box, Typography } from '@mui/material'
import FichaDeudor from './FichaDeudor';
import DeudoresTable from './DeudoresTable';

interface Props {
    user: { nombre: string; rol: string }
    selectedTab: number
    setSelectedTab: (index: number) => void
    selectedDeudorId: number | null
    setSelectedDeudorId: (id: number | null) => void
}

const TabsPanel: React.FC<Props> = ({
    user,
    selectedTab,
    setSelectedTab,
    selectedDeudorId,
    setSelectedDeudorId,
}) => {
    return (
        <>
            {(user.rol === 'admin' || user.rol === 'operador') && (
                <Tabs value={selectedTab} onChange={(_, v) => setSelectedTab(v)} sx={{ mb: 2 }}>
                    <Tab label="👤 Datos del deudor" />
                    <Tab label="📋 Lista de deudores" />
                </Tabs>
            )}

            {selectedTab === 0 && user.rol !== 'invitado' && selectedDeudorId && (
                <FichaDeudor deudorId={selectedDeudorId} />
            )}

            {selectedTab === 0 && !selectedDeudorId && (
                <Typography>Seleccioná un deudor desde la pestaña “Lista”.</Typography>
            )}

            {selectedTab === 1 && (
                <DeudoresTable
                    selectedDeudorId={selectedDeudorId}
                    setSelectedDeudorId={setSelectedDeudorId}
                />
            )}
        </>
    )
}

export default TabsPanel