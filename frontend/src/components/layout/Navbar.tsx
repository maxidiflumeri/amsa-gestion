// src/components/layout/Navbar.tsx
import React from 'react'
import { AppBar, Toolbar, Typography, IconButton, Avatar, Box } from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import logo from '../../assets/logo-amsa-gestion.png';

interface Props {
    drawerOpen: boolean
    setDrawerOpen: (open: boolean) => void
    user: { nombre: string; rol: string }
}

const Navbar: React.FC<Props> = ({ drawerOpen, setDrawerOpen, user }) => {
    return (
        <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
            <Toolbar sx={{ justifyContent: 'space-between' }}>
                <Box display="flex" alignItems="center">
                    <IconButton color="inherit" onClick={() => setDrawerOpen(!drawerOpen)} edge="start" sx={{ mr: 2 }}>
                        {drawerOpen ? <ChevronLeftIcon /> : <MenuIcon />}
                    </IconButton>
                    <img
                        src={logo}
                        alt="amsasender logo"
                        style={{ height: 60 }}
                    />
                    <Typography variant="h6" noWrap fontWeight="bold" style={{ marginLeft: 10 }}>
                        AMSA Gestión
                    </Typography>
                </Box>
                <Avatar alt={user.nombre} src="/avatar.png" />
            </Toolbar>
        </AppBar>
    )
}

export default Navbar