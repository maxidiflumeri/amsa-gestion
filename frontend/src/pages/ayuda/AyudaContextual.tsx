import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
    Box,
    Button,
    Chip,
    Divider,
    Drawer,
    IconButton,
    Stack,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import CloseIcon from '@mui/icons-material/Close'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import { buscarPagina, paginasParaRuta } from './contenido'
import Markdown from './Markdown'

/**
 * El botón "?" de la barra superior: abre la ayuda **de la pantalla en la que estás**.
 *
 * Vive en la barra y no en cada página a propósito: la pantalla se deduce de la ruta, así que una
 * página de ayuda nueva queda enganchada sola con solo declarar su `rutaPrincipal`.
 *
 * Abre en un panel lateral y no navegando a `/ayuda` porque el momento en que alguien busca ayuda
 * es, casi siempre, con un formulario a medio llenar. Salir de la pantalla se lo llevaría puesto.
 *
 * Cuando la pantalla tiene varias páginas —Gestión y Reportes tienen seis— se muestra la principal
 * y se ofrecen las hermanas arriba. Por eso la principal se declara explícita en el markdown: si
 * saliera del orden de los archivos, el "?" de Gestión abriría "Cómo piensa el sistema".
 */

const ANCHO = 560

const AyudaContextual: React.FC = () => {
    const theme = useTheme()
    const angosto = useMediaQuery(theme.breakpoints.down('sm'))
    const navigate = useNavigate()
    const { pathname } = useLocation()

    const [abierto, setAbierto] = useState(false)
    const [slug, setSlug] = useState<string | null>(null)

    const paginas = useMemo(() => paginasParaRuta(pathname), [pathname])
    const principal = paginas[0]

    // Cambiar de pantalla con el panel abierto tiene que traer la ayuda de la pantalla nueva.
    useEffect(() => setSlug(null), [pathname])

    const pagina = (slug ? buscarPagina(slug) : undefined) ?? principal
    const hermanas = paginas.filter((p) => p.slug !== pagina?.slug)

    const irAlVisor = () => {
        setAbierto(false)
        navigate(pagina ? `/ayuda/${pagina.slug}` : '/ayuda')
    }

    return (
        <>
            <Tooltip title={principal ? 'Ayuda de esta pantalla' : 'Documentación'}>
                <IconButton color="inherit" onClick={() => setAbierto(true)} aria-label="Ayuda de esta pantalla">
                    <HelpOutlineIcon />
                </IconButton>
            </Tooltip>

            <Drawer
                anchor="right"
                open={abierto}
                onClose={() => setAbierto(false)}
                PaperProps={{ sx: { width: angosto ? '100%' : ANCHO, maxWidth: '100%' } }}
            >
                <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}
                >
                    <MenuBookIcon fontSize="small" color="action" />
                    <Typography variant="subtitle1" fontWeight={700} noWrap sx={{ flexGrow: 1 }}>
                        {pagina?.titulo ?? 'Documentación'}
                    </Typography>
                    <IconButton size="small" onClick={() => setAbierto(false)} aria-label="Cerrar">
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Stack>

                {hermanas.length > 0 && (
                    <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover' }}>
                        <Typography variant="overline" color="text.secondary">
                            También en esta pantalla
                        </Typography>
                        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
                            {hermanas.map((p) => (
                                <Chip
                                    key={p.slug}
                                    size="small"
                                    label={p.titulo}
                                    onClick={() => setSlug(p.slug)}
                                    title={p.resumen}
                                />
                            ))}
                        </Stack>
                    </Box>
                )}

                <Box sx={{ px: 3, py: 2.5, overflowY: 'auto', flexGrow: 1 }}>
                    {pagina ? (
                        <Markdown texto={pagina.cuerpo} onNavegarInterno={(s) => setSlug(s)} />
                    ) : (
                        <Stack spacing={2} sx={{ py: 4 }} alignItems="flex-start">
                            <Typography variant="body1" color="text.secondary">
                                Esta pantalla todavía no tiene una página de ayuda propia.
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                En Documentación está el resto de la wiki, con buscador.
                            </Typography>
                        </Stack>
                    )}
                </Box>

                <Divider />
                <Box sx={{ px: 2, py: 1.5 }}>
                    <Button size="small" startIcon={<MenuBookIcon />} onClick={irAlVisor}>
                        {pagina ? 'Abrir en Documentación' : 'Ir a Documentación'}
                    </Button>
                </Box>
            </Drawer>
        </>
    )
}

export default AyudaContextual
