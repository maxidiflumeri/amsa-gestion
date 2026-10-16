import React, { useEffect } from 'react';
import { Box, Button, ButtonBase, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import type { MiDiaDto } from '../../../api/inicio';
import BuscadorAvanzadoModal from '../../../components/deudores/BuscadorAvanzadoModal';
import { useAuth } from '../../../context/AuthContext';
import { linkCaso } from '../../../utils/linkCaso';
import { fmtNumber } from '../../dashboards/utils';
import { fechaLarga, saludo, ymdLocal } from '../formato';
import { accesosRapidos, puedeBuscar } from '../reglasBloques';

interface Props {
    datos: MiDiaDto | null;
    abierto: boolean;
    onAbrir: () => void;
    onCerrar: () => void;
}

/** La línea de estado de debajo del saludo. Nunca depende de que el backend haya contestado. */
function lineaDeEstado(datos: MiDiaDto | null): string {
    const hoy = datos?.hoy ?? ymdLocal();
    const partes = [fechaLarga(hoy)];
    const g = datos?.gestiones;
    if (g) {
        const n = `${fmtNumber(g.hoy)}${g.truncado ? '+' : ''}`;
        partes.push(g.hoy === 0 ? 'Todavía no registraste gestiones hoy' : `Llevás ${n} ${g.hoy === 1 ? 'gestión' : 'gestiones'} hoy`);
    }
    const v = datos?.promesas?.vencenHoy.cantidad ?? 0;
    if (v > 0) partes.push(`${fmtNumber(v)} ${v === 1 ? 'promesa tuya vence' : 'promesas tuyas vencen'} hoy`);
    return partes.join(' · ');
}

/** En una Mac el atajo se muestra con ⌘ (funciona con las dos teclas en cualquier sistema). */
const esMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

/** B1 + B2 + B3: el saludo, los accesos rápidos y el buscador (con Ctrl+K mientras Inicio está montado). */
const SaludoBuscador: React.FC<Props> = ({ datos, abierto, onAbrir, onCerrar }) => {
    const { usuario, tienePermiso } = useAuth();
    const navigate = useNavigate();
    const buscar = puedeBuscar(tienePermiso);
    const accesos = accesosRapidos(tienePermiso);
    const nombre = (usuario?.nombre ?? '').trim().split(/\s+/)[0];

    useEffect(() => {
        if (!buscar || abierto) return;
        const alTeclear = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                onAbrir();
            }
        };
        window.addEventListener('keydown', alTeclear);
        return () => window.removeEventListener('keydown', alTeclear);
    }, [buscar, abierto, onAbrir]);

    return (
        <Box component="section" aria-label="Saludo">
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) auto' },
                    gap: { xs: 1.5, md: 3 },
                    alignItems: 'end',
                }}
            >
                <Box sx={{ minWidth: 0 }}>
                    <Typography component="h1" fontWeight={700} sx={{ fontSize: { xs: 22, sm: 26 }, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                        {saludo(new Date().getHours())}
                        {nombre ? `, ${nombre}` : ''}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {lineaDeEstado(datos)}
                    </Typography>
                </Box>
                {accesos.length > 0 && (
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" aria-label="Accesos rápidos">
                        {accesos.map((a, i) => (
                            <Button key={a.id} component={RouterLink} to={a.ruta} size="small" variant={i === 0 ? 'contained' : 'outlined'} color={i === 0 ? 'primary' : 'inherit'}>
                                {a.etiqueta}
                            </Button>
                        ))}
                    </Stack>
                )}
            </Box>

            {buscar && (
                <>
                    <ButtonBase
                        onClick={onAbrir}
                        aria-label="Buscar un caso"
                        aria-keyshortcuts="Control+K Meta+K"
                        sx={(theme) => ({
                            mt: 2,
                            width: '100%',
                            justifyContent: 'flex-start',
                            gap: 1.5,
                            px: 2,
                            py: 1.5,
                            borderRadius: 2,
                            border: 1,
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            color: 'text.secondary',
                            textAlign: 'left',
                            '&:hover': { borderColor: 'primary.main' },
                            '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}` },
                        })}
                    >
                        <SearchIcon fontSize="small" />
                        <Typography variant="body2" color="inherit" noWrap sx={{ flex: 1, minWidth: 0 }}>
                            Buscar un caso por DNI, nombre, número de cliente o teléfono
                        </Typography>
                        <Box
                            component="kbd"
                            sx={(theme) => ({
                                display: { xs: 'none', sm: 'inline-block' },
                                flex: 'none',
                                fontFamily: 'monospace',
                                fontSize: 11,
                                px: 0.75,
                                py: 0.25,
                                borderRadius: 0.75,
                                border: 1,
                                borderColor: alpha(theme.palette.text.primary, 0.25),
                                color: 'text.secondary',
                            })}
                        >
                            {esMac ? '⌘ K' : 'Ctrl K'}
                        </Box>
                    </ButtonBase>
                    <BuscadorAvanzadoModal
                        open={abierto}
                        onClose={onCerrar}
                        onSelectDeudor={(id) => {
                            onCerrar();
                            navigate(linkCaso(id));
                        }}
                    />
                </>
            )}
        </Box>
    );
};

export default SaludoBuscador;
