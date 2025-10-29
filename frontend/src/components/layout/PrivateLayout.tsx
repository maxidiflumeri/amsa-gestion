import React from 'react'
import { Box, CssBaseline, Toolbar } from '@mui/material'
import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'
import { useTheme } from '@mui/material'

const drawerWidth = 240

const PrivateLayout = () => {
    const [drawerOpen, setDrawerOpen] = React.useState(true)
    const theme = useTheme()

    const user = { nombre: 'Maxi', rol: 'admin' } // luego desde contexto

    return (
        <Box sx={{ display: 'flex' }}>
            <CssBaseline />
            <Navbar drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen} user={user} />
            <Sidebar drawerOpen={drawerOpen} />
            <Box component="main" sx={{ flexGrow: 1, p: 3, ml: drawerOpen ? 0 : `-${drawerWidth}px`, transition: theme.transitions.create('margin') }}>
                <Toolbar />
                <Outlet />
            </Box>
        </Box>
    )
}

export default PrivateLayout