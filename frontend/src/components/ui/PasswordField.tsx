import React from 'react';
import {
    Button,
    IconButton,
    InputAdornment,
    Stack,
    TextField,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

interface PasswordFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    show: boolean;
    onToggleShow: () => void;
    /** En modo edición de registro existente: si false = campo disabled + botón Cambiar */
    editando: boolean;
    onActivarEdicion: () => void;
    /** true cuando es alta (nuevo registro) — campo siempre editable */
    esAlta: boolean;
    required?: boolean;
    helperText?: string;
}

const PasswordField: React.FC<PasswordFieldProps> = ({
    label,
    value,
    onChange,
    show,
    onToggleShow,
    editando,
    onActivarEdicion,
    esAlta,
    required,
    helperText,
}) => {
    const activo = esAlta || editando;

    return (
        <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
                label={label}
                type={show ? 'text' : 'password'}
                value={activo ? value : '••••••••'}
                onChange={(e) => onChange(e.target.value)}
                disabled={!activo}
                fullWidth
                required={required && activo}
                helperText={helperText}
                InputProps={{
                    endAdornment: activo ? (
                        <InputAdornment position="end">
                            <IconButton onClick={onToggleShow} edge="end" size="small">
                                {show ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                            </IconButton>
                        </InputAdornment>
                    ) : undefined,
                }}
            />
            {!esAlta && !editando && (
                <Button
                    size="small"
                    variant="outlined"
                    onClick={onActivarEdicion}
                    sx={{ mt: 1, whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                    Cambiar
                </Button>
            )}
        </Stack>
    );
};

export default PasswordField;
