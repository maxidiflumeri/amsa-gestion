// src/components/layout/Sidebar.tsx
import React from 'react'
import { Drawer, Toolbar, List, ListItem, ListItemButton, ListItemIcon, ListItemText } from '@mui/material'
import AssignmentIcon from '@mui/icons-material/Assignment'
import { useNavigate } from 'react-router-dom'

interface Props {
    drawerOpen: boolean
}

const Sidebar: React.FC<Props> = ({ drawerOpen }) => {
    const navigate = useNavigate()

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
            <Toolbar />
            <List>
                <ListItem disablePadding>
                    <ListItemButton onClick={() => navigate('/gestion')}>
                        <ListItemIcon><AssignmentIcon /></ListItemIcon>
                        <ListItemText primary="Gestión" />
                    </ListItemButton>
                </ListItem>
            </List>
        </Drawer>
    )
}

export default Sidebar