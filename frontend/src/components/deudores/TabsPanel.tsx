import React, { useEffect, useState } from 'react'
import { Tabs, Tab, Box, Typography, Paper, Button } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search';
import PolicyIcon from '@mui/icons-material/Policy';
import FichaDeudor from './FichaDeudor';
import DeudoresTable from './DeudoresTable';
import BuscadorAvanzadoModal from './BuscadorAvanzadoModal';
import PoliticaTab from './PoliticaTab';

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
    const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
    
    // Al cambiar de pestaña o de deudor, forzamos el scroll al top
    useEffect(() => {
        const timeout = setTimeout(() => {
            // Intentamos hacer scroll en el window primero
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            
            // Si el layout privado (MUI Box 'main') tiene el scroll retenido oculto, lo forzamos al top también
            const mainContent = document.querySelector('main');
            if (mainContent) {
                mainContent.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            }
            // En caso que el html o body estén scrolleados desparejos
            document.documentElement.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            document.body.scrollTo({ top: 0, left: 0, behavior: 'auto' });
            
        }, 100); // 100ms da margen seguro post-render de lista vs ficha
        return () => clearTimeout(timeout);
    }, [selectedTab, selectedDeudorId]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {(user.rol === 'admin' || user.rol === 'operador') && (
                <Paper 
                    elevation={4} 
                    sx={{ 
                        position: 'sticky',
                        top: 64, // Altura de la Toolbar de MUI (Navbar), para que quede justo pegado abajo
                        zIndex: 1100,
                        mb: 3,
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center',
                        pr: 2
                    }}
                >
                    <Tabs 
                        value={selectedTab} 
                        onChange={(_, v) => setSelectedTab(v)} 
                        indicatorColor="primary"
                        textColor="primary"
                        sx={{ flexGrow: 1, bgcolor: 'background.paper', borderRadius: 2 }}
                    >
                        <Tab label="👤 Datos del deudor" sx={{ fontWeight: 'bold' }} />
                        <Tab label="📋 Lista de deudores" sx={{ fontWeight: 'bold' }} />
                        <Tab icon={<PolicyIcon fontSize="small" />} iconPosition="start" label="Política" sx={{ fontWeight: 'bold' }} />
                    </Tabs>
                    <Button 
                        variant="outlined" 
                        color="primary" 
                        startIcon={<SearchIcon />}
                        onClick={() => setAdvancedSearchOpen(true)}
                        sx={{ ml: 2, whiteSpace: 'nowrap', borderRadius: 2, fontWeight: 'bold' }}
                    >
                        Búsqueda Avanzada
                    </Button>
                </Paper>
            )}

            <Box sx={{ flexGrow: 1 }}>
                {selectedTab === 0 && user.rol !== 'invitado' && selectedDeudorId && (
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
            </Box>

            {/* Modal Global de Búsqueda Avanzada */}
            <BuscadorAvanzadoModal 
                open={advancedSearchOpen} 
                onClose={() => setAdvancedSearchOpen(false)} 
                onSelectDeudor={(id) => {
                    setSelectedDeudorId(id);
                    // Forzamos ir a la pestaña "Datos del deudor"
                    setSelectedTab(0);
                }} 
            />
        </Box>
    )
}

export default TabsPanel