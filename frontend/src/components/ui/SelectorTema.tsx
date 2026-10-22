import React from 'react';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useColorMode, type PreferenciaTema } from '../../context/ColorModeContext';

const OPCIONES: Array<{ valor: PreferenciaTema; etiqueta: string; Icono: LucideIcon }> = [
    { valor: 'light', etiqueta: 'Claro', Icono: Sun },
    { valor: 'dark', etiqueta: 'Oscuro', Icono: Moon },
    { valor: 'system', etiqueta: 'Sistema', Icono: Monitor },
];

/** Claro, Oscuro o Sistema, como un control segmentado. Lo usan el menú de la cuenta y «Mi perfil». */
const SelectorTema: React.FC<{ alto?: number }> = ({ alto = 32 }) => {
    const { preferencia, setPreferencia } = useColorMode();
    return (
        <ToggleButtonGroup
            exclusive
            fullWidth
            value={preferencia}
            onChange={(_e, valor: PreferenciaTema | null) => valor && setPreferencia(valor)}
            aria-label="Tema"
            sx={(theme) => ({
                p: '3px',
                gap: '2px',
                borderRadius: '11px',
                bgcolor: alpha(theme.palette.text.primary, 0.05),
                '& .MuiToggleButtonGroup-grouped': {
                    border: 0,
                    m: 0,
                    borderRadius: '8px !important',
                },
            })}
        >
            {OPCIONES.map(({ valor, etiqueta, Icono }) => (
                <ToggleButton
                    key={valor}
                    value={valor}
                    sx={(theme) => ({
                        // 44 px para el dedo en el celular y la tablet.
                        height: { xs: 44, md: alto },
                        gap: 0.75,
                        textTransform: 'none',
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        color: 'text.secondary',
                        '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.05) },
                        '&.Mui-selected, &.Mui-selected:hover': {
                            color: 'text.primary',
                            fontWeight: 600,
                            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.common.white, 0.1) : theme.palette.background.paper,
                            boxShadow: `${theme.shadows[1]}, 0 0 0 1px ${theme.palette.divider}`,
                        },
                    })}
                >
                    <Icono size={15} strokeWidth={1.75} aria-hidden />
                    {etiqueta}
                </ToggleButton>
            ))}
        </ToggleButtonGroup>
    );
};

export default SelectorTema;
