// src/pages/DeudoresPage.tsx
import React, { useEffect, useState } from 'react'
import { Box, CircularProgress } from '@mui/material'
import TabsPanel from '../components/deudores/TabsPanel'
import api from '../api/axios'

const DeudoresPage = () => {
    const [selectedTab, setSelectedTab] = useState(0)
    const [selectedDeudorId, setSelectedDeudorId] = useState<number | null>(() => {
        const saved = localStorage.getItem('last_deudor_id');
        return saved ? parseInt(saved, 10) : null;
    });
    const [loading, setLoading] = useState(true)

    const user = { nombre: 'Maxi', rol: 'admin' } // mock o traer desde contexto

    useEffect(() => {
        // Persistir el ID seleccionado en localStorage cuando el usuario navegue o lo cambie
        if (selectedDeudorId) {
            localStorage.setItem('last_deudor_id', selectedDeudorId.toString());
        }
    }, [selectedDeudorId]);

    useEffect(() => {
        // Al montar la página si ya existe un deudor cacheado, no hacemos el fetch
        if (selectedDeudorId) {
            setLoading(false);
            return;
        }

        // Si venimos sin deudor (entró por primera vez), fetcheamos 1 solo para pre-seleccionarlo
        const fetchPrimerDeudor = async () => {
            try {
                const res = await api.get('/deudores', { params: { page: 1, limit: 1 } })
                
                // Si la paginación de la API devuelve en formato 'data: { data: [...] }'
                const firstDeudor = res.data?.data?.[0] || res.data?.[0];
                
                if (firstDeudor?.id) {
                    setSelectedDeudorId(firstDeudor.id);
                }
            } catch (error) {
                console.error("Error al pre-cargar el primer deudor:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchPrimerDeudor();
    }, []);

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="calc(100vh - 100px)">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <TabsPanel
            user={user}
            selectedTab={selectedTab}
            setSelectedTab={setSelectedTab}
            selectedDeudorId={selectedDeudorId}
            setSelectedDeudorId={setSelectedDeudorId}
        />
    )
}

export default DeudoresPage