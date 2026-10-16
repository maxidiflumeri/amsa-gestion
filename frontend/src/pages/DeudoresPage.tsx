// src/pages/DeudoresPage.tsx
import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import TabsPanel from '../components/deudores/TabsPanel'
import { PageHeader, LoadingSkeleton } from '../components/ui'
import api from '../api/axios'
import { useNotify } from '../hooks/useNotify'
import { leerDeudorDeUrl } from '../utils/linkCaso'

const DeudoresPage = () => {
    const notify = useNotify()
    const [selectedTab, setSelectedTab] = useState(0)
    const [searchParams, setSearchParams] = useSearchParams()
    const [selectedDeudorId, setSelectedDeudorId] = useState<number | null>(() => {
        // Un enlace `/gestion?deudor=ID` (Inicio, detalle de los tableros) gana sobre el último caso trabajado.
        const pedido = leerDeudorDeUrl(searchParams.toString())
        if (pedido) return pedido
        const saved = localStorage.getItem('last_deudor_id')
        return saved ? parseInt(saved, 10) : null
    })
    const [loading, setLoading] = useState(true)
    const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false)

    // El id del enlace se consume y se borra de la URL: así elegir otro caso y recargar no vuelve al del enlace.
    useEffect(() => {
        const pedido = leerDeudorDeUrl(searchParams.toString())
        if (!pedido) return
        setSelectedDeudorId(pedido)
        const resto = new URLSearchParams(searchParams)
        resto.delete('deudor')
        setSearchParams(resto, { replace: true })
    }, [searchParams, setSearchParams])

    useEffect(() => {
        if (selectedDeudorId) {
            localStorage.setItem('last_deudor_id', selectedDeudorId.toString())
        }
    }, [selectedDeudorId])

    useEffect(() => {
        if (selectedDeudorId) {
            setLoading(false)
            return
        }

        const fetchPrimerDeudor = async () => {
            try {
                const res = await api.get('/deudores', { params: { page: 1, limit: 1 } })
                const firstDeudor = res.data?.data?.[0] || res.data?.[0]
                if (firstDeudor?.id) {
                    setSelectedDeudorId(firstDeudor.id)
                }
            } catch (error) {
                notify.error(error as Error)
            } finally {
                setLoading(false)
            }
        }

        fetchPrimerDeudor()
    }, [])

    if (loading) {
        return (
            <Box sx={{ p: 3 }}>
                <LoadingSkeleton variant="detail" />
            </Box>
        )
    }

    return (
        <Box>
            <PageHeader
                title="Gestión de deudores"
                actions={[
                    {
                        label: 'Búsqueda avanzada',
                        startIcon: <SearchIcon />,
                        onClick: () => setAdvancedSearchOpen(true),
                        variant: 'outlined',
                    },
                ]}
            />
            <TabsPanel
                selectedTab={selectedTab}
                setSelectedTab={setSelectedTab}
                selectedDeudorId={selectedDeudorId}
                setSelectedDeudorId={setSelectedDeudorId}
                advancedSearchOpen={advancedSearchOpen}
                setAdvancedSearchOpen={setAdvancedSearchOpen}
            />
        </Box>
    )
}

export default DeudoresPage
