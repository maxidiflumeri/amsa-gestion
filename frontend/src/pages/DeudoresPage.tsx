// src/pages/DeudoresPage.tsx
import React from 'react'
import TabsPanel from '../components/deudores/TabsPanel'

const DeudoresPage = () => {
    const [selectedTab, setSelectedTab] = React.useState(0)
    const [selectedDeudorId, setSelectedDeudorId] = React.useState<number | null>(null)

    const user = { nombre: 'Maxi', rol: 'admin' } // mock o traer desde contexto

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