import React, { useState } from 'react';
import { Button, CircularProgress, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import TableViewIcon from '@mui/icons-material/TableView';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { dashboardsApi, type FormatoExportDashboard } from '../../../api/dashboards';
import { useAuth } from '../../../context/AuthContext';
import { useNotify } from '../../../hooks/useNotify';
import type { SnapshotFiltros } from '../../../types/dashboards';

interface Props {
    filtros: SnapshotFiltros;
    nombreTablero?: string;
    disabled?: boolean;
}

const ExportarMenu: React.FC<Props> = ({ filtros, nombreTablero, disabled }) => {
    const { tienePermiso } = useAuth();
    const notify = useNotify();
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [loading, setLoading] = useState(false);

    if (!tienePermiso('dashboards.exportar')) return null;

    const handleExport = async (formato: FormatoExportDashboard) => {
        setAnchorEl(null);
        setLoading(true);
        try {
            const { blob, filename } = await dashboardsApi.exportar({
                ...filtros,
                formato,
                nombreTablero,
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            notify.success('Exportación completada');
        } catch (err: any) {
            notify.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Button
                size="small"
                variant="outlined"
                startIcon={loading ? <CircularProgress size={16} /> : <FileDownloadIcon />}
                onClick={(e) => setAnchorEl(e.currentTarget)}
                disabled={disabled || loading}
            >
                Exportar
            </Button>
            <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
                <MenuItem onClick={() => handleExport('xlsx')}>
                    <ListItemIcon><TableViewIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="Excel (.xlsx)" />
                </MenuItem>
                <MenuItem onClick={() => handleExport('pdf')}>
                    <ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon>
                    <ListItemText primary="PDF (.pdf)" />
                </MenuItem>
            </Menu>
        </>
    );
};

export default ExportarMenu;
