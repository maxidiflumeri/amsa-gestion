import React, { useRef } from 'react'
import { Tabs, Tab, Box, useMediaQuery, useTheme } from '@mui/material'
import PolicyIcon from '@mui/icons-material/Policy'
import HistoryIcon from '@mui/icons-material/History'
import FichaDeudor from './ficha'
import DeudoresTable from './DeudoresTable'
import BuscadorAvanzadoModal from './BuscadorAvanzadoModal'
import PoliticaTab from './PoliticaTab'
import TimelineDeudorTab from './TimelineDeudorTab'

interface Props {
    selectedTab: number
    setSelectedTab: (index: number) => void
    selectedDeudorId: number | null
    setSelectedDeudorId: (id: number | null) => void
    advancedSearchOpen: boolean
    setAdvancedSearchOpen: (open: boolean) => void
}

const TabsPanel: React.FC<Props> = ({
    selectedTab,
    setSelectedTab,
    selectedDeudorId,
    setSelectedDeudorId,
    advancedSearchOpen,
    setAdvancedSearchOpen,
}) => {
    const theme = useTheme()
    const isMobile = useMediaQuery(theme.breakpoints.down('md'))
    const tabContentRef = useRef<HTMLDivElement>(null)

    const handleTabChange = (_: React.SyntheticEvent, v: number) => {
        setSelectedTab(v)
        // Scroll limpio al contenedor del tab activo
        setTimeout(() => {
            tabContentRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
        }, 50)
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {/*
              Acá había un gate por rol que **nunca funcionó**: el usuario venía hardcodeado desde
              `DeudoresPage` (`{ nombre: 'Maxi', rol: 'admin' }`), así que todo el mundo pasaba. Y
              conectarlo al contexto real las habría hecho desaparecer para todos, porque en la base
              `usuario.rol` es el string legacy 'usuario' para el 100% de los usuarios — los roles
              reales viven en la tabla `rol`.
              Se saca: quien llega a esta pantalla ya tiene `deudores.ver`, que es lo que protege el
              backend en todo lo que hay adentro.
            */}
            <Tabs
                    value={selectedTab}
                    onChange={handleTabChange}
                    indicatorColor="primary"
                    textColor="primary"
                    variant={isMobile ? 'scrollable' : 'standard'}
                    scrollButtons={isMobile ? 'auto' : undefined}
                    allowScrollButtonsMobile
                    sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
                >
                    <Tab label="Datos del deudor" sx={{ fontWeight: 'bold' }} />
                    <Tab label="Lista de deudores" sx={{ fontWeight: 'bold' }} />
                    <Tab icon={<PolicyIcon fontSize="small" />} iconPosition="start" label="Política" sx={{ fontWeight: 'bold' }} />
                    <Tab icon={<HistoryIcon fontSize="small" />} iconPosition="start" label="Timeline" sx={{ fontWeight: 'bold' }} />
                </Tabs>

            <Box ref={tabContentRef} sx={{ flexGrow: 1 }}>
                {selectedTab === 0 && selectedDeudorId && (
                    <FichaDeudor deudorId={selectedDeudorId} />
                )}

                {selectedTab === 1 && (
                    <DeudoresTable
                        selectedDeudorId={selectedDeudorId}
                        setSelectedDeudorId={setSelectedDeudorId}
                        onDoubleClickRow={() => setSelectedTab(0)}
                    />
                )}

                {selectedTab === 2 && (
                    <PoliticaTab deudorId={selectedDeudorId} />
                )}

                {selectedTab === 3 && (
                    <TimelineDeudorTab deudorId={selectedDeudorId} />
                )}
            </Box>

            <BuscadorAvanzadoModal
                open={advancedSearchOpen}
                onClose={() => setAdvancedSearchOpen(false)}
                onSelectDeudor={(id) => {
                    setSelectedDeudorId(id)
                    setSelectedTab(0)
                }}
            />
        </Box>
    )
}

export default TabsPanel
