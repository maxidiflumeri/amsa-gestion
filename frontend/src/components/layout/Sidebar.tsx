import React from 'react'
import { Drawer, Toolbar, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Box, Divider, Switch, Stack, Typography } from '@mui/material'
import AssignmentIcon from '@mui/icons-material/Assignment'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import { useNavigate } from 'react-router-dom'
import { useColorMode } from '../../context/ThemeContext'

interface Props {
    drawerOpen: boolean
}

const Sidebar: React.FC<Props> = ({ drawerOpen }) => {
    const navigate = useNavigate()
    const { mode, toggleColorMode } = useColorMode()

    return (
        <Drawer
            variant="persistent"
            anchor="left"
            open={drawerOpen}
            sx={{
                width: 240,
                flexShrink: 0,
                '& .MuiDrawer-paper': {
                    width: 240,
                    boxSizing: 'border-box'
                },
            }}
        >
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <Toolbar />
                <List sx={{ flexGrow: 1 }}>
                    <ListItem disablePadding>
                        <ListItemButton onClick={() => navigate('/gestion')}>
                            <ListItemIcon><AssignmentIcon /></ListItemIcon>
                            <ListItemText primary="Gestión" />
                        </ListItemButton>
                    </ListItem>
                    <ListItem disablePadding>
                        <ListItemButton onClick={() => navigate('/carga')}>
                            <ListItemIcon><AssignmentIcon /></ListItemIcon>
                            <ListItemText primary="Carga" />
                        </ListItemButton>
                    </ListItem>
                    <ListItem disablePadding>
                        <ListItemButton onClick={() => navigate('/plantillas')}>
                            <ListItemIcon><AssignmentIcon /></ListItemIcon>
                            <ListItemText primary="Plantillas" />
                        </ListItemButton>
                    </ListItem>
                </List>
                
                <Divider />
                <Box sx={{ p: 2 }}>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
                        <LightModeIcon sx={{ color: mode === 'light' ? 'warning.main' : 'text.disabled', fontSize: 20 }} />
                        <Switch 
                            checked={mode === 'dark'} 
                            onChange={toggleColorMode} 
                            color="primary"
                            inputProps={{ 'aria-label': 'Alternar Modo Oscuro' }}
                        />
                        <DarkModeIcon sx={{ color: mode === 'dark' ? 'primary.main' : 'text.disabled', fontSize: 20 }} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block" align="center" sx={{ mt: 0.5 }}>
                        {mode === 'light' ? 'Tema Claro' : 'Tema Oscuro'}
                    </Typography>
                </Box>
            </Box>
        </Drawer>
    )
}

export default Sidebar