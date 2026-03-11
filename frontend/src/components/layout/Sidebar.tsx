import React, { useState } from 'react'
import { Drawer, Toolbar, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Box, Divider, Switch, Stack, Typography, Collapse } from '@mui/material'
import AssignmentIcon from '@mui/icons-material/Assignment'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import HistoryIcon from '@mui/icons-material/History'
import DescriptionIcon from '@mui/icons-material/Description'
import { useNavigate } from 'react-router-dom'
import { useColorMode } from '../../context/ThemeContext'

interface Props {
    drawerOpen: boolean
}

const Sidebar: React.FC<Props> = ({ drawerOpen }) => {
    const navigate = useNavigate()
    const { mode, toggleColorMode } = useColorMode()
    const [openImport, setOpenImport] = useState(false)

    const handleClickImport = () => {
        setOpenImport(!openImport)
    }

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
                    
                    {/* Sección Grupo de Importaciones */}
                    <ListItem disablePadding>
                        <ListItemButton onClick={handleClickImport}>
                            <ListItemIcon><UploadFileIcon /></ListItemIcon>
                            <ListItemText primary="Importación de Datos" />
                            {openImport ? <ExpandLess /> : <ExpandMore />}
                        </ListItemButton>
                    </ListItem>
                    <Collapse in={openImport} timeout="auto" unmountOnExit>
                        <List component="div" disablePadding>
                            <ListItemButton sx={{ pl: 4 }} onClick={() => navigate('/carga')}>
                                <ListItemIcon><UploadFileIcon fontSize="small" /></ListItemIcon>
                                <ListItemText primary="Nueva Importación" />
                            </ListItemButton>
                            <ListItemButton sx={{ pl: 4 }} onClick={() => navigate('/historial-importaciones')}>
                                <ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>
                                <ListItemText primary="Historial" />
                            </ListItemButton>
                            <ListItemButton sx={{ pl: 4 }} onClick={() => navigate('/plantillas')}>
                                <ListItemIcon><DescriptionIcon fontSize="small" /></ListItemIcon>
                                <ListItemText primary="Plantillas" />
                            </ListItemButton>
                        </List>
                    </Collapse>
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