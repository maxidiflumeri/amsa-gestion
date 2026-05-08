import React from 'react';
import {
    Box,
    Button,
    Card,
    CardContent,
    CardHeader,
    Grid,
    MenuItem,
    TextField,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface Props {
    estadoSituacion: string;
    estadoGestion: string;
    motivoNoPago: string;
    estadosSituacion: any[] | null;
    estadosGestion: any[] | null;
    motivosNoPago: any[];
    cambiosPendientes: boolean;
    onEstadoChange: (type: 'situacion' | 'gestion' | 'motivoNoPago', value: string) => void;
    onGuardar: () => void;
}

const FichaEstadosCard: React.FC<Props> = ({
    estadoSituacion,
    estadoGestion,
    motivoNoPago,
    estadosSituacion,
    estadosGestion,
    motivosNoPago,
    cambiosPendientes,
    onEstadoChange,
    onGuardar,
}) => {
    return (
        <Card elevation={2} sx={{ mb: 3, borderRadius: 3 }}>
            <CardHeader
                title="Gestión y Estado"
                titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
                sx={{ pb: 0 }}
            />
            <CardContent>
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} sm={4}>
                        <TextField
                            select
                            fullWidth
                            label="Situación del cliente"
                            size="small"
                            value={estadoSituacion}
                            onChange={(e) => onEstadoChange('situacion', e.target.value)}
                            variant="outlined"
                        >
                            {estadosSituacion?.map((est: any) => (
                                <MenuItem key={est.clave} value={est.clave}>
                                    {est.descripcion}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            select
                            fullWidth
                            label="Estado de Gestión"
                            size="small"
                            value={estadoGestion}
                            onChange={(e) => onEstadoChange('gestion', e.target.value)}
                            variant="outlined"
                        >
                            {estadosGestion?.map((est: any) => (
                                <MenuItem key={est.clave} value={est.clave}>
                                    {est.descripcion}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            select
                            fullWidth
                            label="Motivo No Pago"
                            size="small"
                            value={motivoNoPago}
                            onChange={(e) => onEstadoChange('motivoNoPago', e.target.value)}
                            variant="outlined"
                        >
                            <MenuItem value="">
                                <em>Sin motivo</em>
                            </MenuItem>
                            {motivosNoPago.map((p: any) => (
                                <MenuItem key={p.id} value={p.clave}>
                                    {p.descripcion}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Grid>
                    <Grid item xs={12}>
                        <Button
                            fullWidth
                            variant="contained"
                            color={cambiosPendientes ? 'primary' : 'inherit'}
                            startIcon={cambiosPendientes ? <SaveIcon /> : <CheckCircleIcon />}
                            onClick={onGuardar}
                            disabled={!cambiosPendientes}
                            sx={{ height: '40px' }}
                        >
                            {cambiosPendientes ? 'Guardar' : 'OK'}
                        </Button>
                    </Grid>
                </Grid>
            </CardContent>
        </Card>
    );
};

export default FichaEstadosCard;
