import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
    Alert,
    Box,
    Chip,
    Divider,
    InputAdornment,
    Link as MuiLink,
    List,
    ListItemButton,
    ListItemText,
    Paper,
    Stack,
    TextField,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PAGINAS, SECCIONES, buscar, buscarPagina } from './contenido'

/**
 * Visor de la documentación de uso.
 *
 * El contenido son archivos markdown de `docs/ayuda/`, embebidos en el bundle en build time
 * (ver `contenido.ts`). No hay endpoint: la ayuda anda aunque el backend esté caído, que es
 * justo cuando alguien la necesita.
 *
 * Sin permiso especial: cualquiera que entre al sistema puede leerla.
 */

const ANCHO_INDICE = 300

const AyudaPage: React.FC = () => {
    const navigate = useNavigate()
    const theme = useTheme()
    const angosto = useMediaQuery(theme.breakpoints.down('md'))
    const { '*': slugRuta } = useParams()
    const [termino, setTermino] = useState('')

    const slug = slugRuta || PAGINAS[0]?.slug
    const pagina = slug ? buscarPagina(slug) : undefined
    const resultados = useMemo(() => buscar(termino), [termino])
    const buscando = termino.trim().length >= 2

    if (!PAGINAS.length) {
        return (
            <Alert severity="info">
                Todavía no hay páginas de ayuda cargadas. Se agregan como archivos markdown en{' '}
                <code>docs/ayuda/</code>.
            </Alert>
        )
    }

    const indice = (
        <Box sx={{ width: angosto ? '100%' : ANCHO_INDICE, flexShrink: 0 }}>
            <TextField
                size="small"
                fullWidth
                placeholder="Buscar en la ayuda…"
                value={termino}
                onChange={(e) => setTermino(e.target.value)}
                InputProps={{
                    startAdornment: (
                        <InputAdornment position="start">
                            <SearchIcon fontSize="small" />
                        </InputAdornment>
                    ),
                }}
                sx={{ mb: 2 }}
            />

            {buscando ? (
                <Box>
                    <Typography variant="overline" color="text.secondary">
                        {resultados.length} resultado{resultados.length === 1 ? '' : 's'}
                    </Typography>
                    <List dense disablePadding>
                        {resultados.map((r) => (
                            <ListItemButton
                                key={r.pagina.slug}
                                onClick={() => { navigate(`/ayuda/${r.pagina.slug}`); setTermino('') }}
                                sx={{ borderRadius: 1, alignItems: 'flex-start' }}
                            >
                                <ListItemText
                                    primary={r.pagina.titulo}
                                    secondary={r.contexto}
                                    primaryTypographyProps={{ fontWeight: 600, variant: 'body2' }}
                                    secondaryTypographyProps={{ variant: 'caption' }}
                                />
                            </ListItemButton>
                        ))}
                        {!resultados.length && (
                            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2 }}>
                                Nada coincide con «{termino}».
                            </Typography>
                        )}
                    </List>
                </Box>
            ) : (
                SECCIONES.map((s) => (
                    <Box key={s.nombre} mb={2}>
                        <Typography variant="overline" color="text.secondary" fontWeight={700}>
                            {s.nombre}
                        </Typography>
                        <List dense disablePadding>
                            {s.paginas.map((p) => (
                                <ListItemButton
                                    key={p.slug}
                                    selected={p.slug === slug}
                                    onClick={() => navigate(`/ayuda/${p.slug}`)}
                                    sx={{ borderRadius: 1, py: 0.5 }}
                                >
                                    <ListItemText
                                        primary={p.titulo}
                                        primaryTypographyProps={{ variant: 'body2' }}
                                    />
                                </ListItemButton>
                            ))}
                        </List>
                    </Box>
                ))
            )}
        </Box>
    )

    return (
        <Box>
            <Stack direction="row" alignItems="center" spacing={1} mb={2}>
                <MenuBookIcon color="primary" />
                <Typography variant="h5" fontWeight={800}>Documentación</Typography>
            </Stack>

            <Stack direction={angosto ? 'column' : 'row'} spacing={3} alignItems="flex-start">
                {indice}

                <Paper variant="outlined" sx={{ flexGrow: 1, p: { xs: 2, md: 4 }, minWidth: 0, width: '100%' }}>
                    {!pagina ? (
                        <Alert severity="warning">
                            No existe la página <code>{slug}</code>. Elegí una del índice.
                        </Alert>
                    ) : (
                        <>
                            <Markdown texto={pagina.cuerpo} />
                            <Divider sx={{ mt: 5, mb: 2 }} />
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                {pagina.revisado && (
                                    <Chip
                                        size="small"
                                        variant="outlined"
                                        label={`Última revisión: ${pagina.revisado}`}
                                    />
                                )}
                                {pagina.rutas.map((r) => (
                                    <Chip
                                        key={r}
                                        size="small"
                                        label={r}
                                        onClick={() => navigate(r)}
                                        title="Ir a la pantalla que documenta esta página"
                                    />
                                ))}
                            </Stack>
                        </>
                    )}
                </Paper>
            </Stack>
        </Box>
    )
}

/**
 * Markdown con los componentes de MUI, para que la ayuda no parezca pegada de otro lado.
 * Las tablas anchas scrollean solas en vez de romper el layout.
 */
const Markdown: React.FC<{ texto: string }> = ({ texto }) => (
    <Box
        sx={{
            '& h1': { typography: 'h4', fontWeight: 900, mt: 0, mb: 2 },
            '& h2': { typography: 'h5', fontWeight: 800, mt: 5, mb: 1.5 },
            '& h3': { typography: 'h6', fontWeight: 700, mt: 3.5, mb: 1 },
            '& p': { typography: 'body1', lineHeight: 1.75, mb: 2 },
            '& li': { typography: 'body1', lineHeight: 1.75, mb: 0.5 },
            '& ol, & ul': { pl: 3, mb: 2 },
            '& code': {
                bgcolor: 'action.hover',
                px: 0.75,
                py: 0.25,
                borderRadius: 0.5,
                fontSize: '0.875em',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            },
            '& pre': {
                bgcolor: 'action.hover',
                p: 2,
                borderRadius: 1,
                overflowX: 'auto',
                mb: 2,
                '& code': { bgcolor: 'transparent', p: 0 },
            },
            '& table': { borderCollapse: 'collapse', width: '100%', mb: 2 },
            '& th, & td': {
                border: '1px solid',
                borderColor: 'divider',
                px: 1.5,
                py: 1,
                textAlign: 'left',
                verticalAlign: 'top',
                typography: 'body2',
            },
            '& th': { bgcolor: 'action.hover', fontWeight: 700 },
            '& blockquote': {
                borderLeft: '4px solid',
                borderColor: 'primary.main',
                bgcolor: 'action.hover',
                m: 0,
                mb: 2,
                px: 2,
                py: 0.5,
                borderRadius: 1,
                '& p': { mb: 1 },
            },
            '& img': { maxWidth: '100%', borderRadius: 1, border: '1px solid', borderColor: 'divider' },
            '& hr': { border: 0, borderTop: '1px solid', borderColor: 'divider', my: 4 },
        }}
    >
        <Box sx={{ '& > div:first-of-type > *:first-of-type': { mt: 0 } }}>
            <div>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        table: ({ children }) => (
                            <Box sx={{ overflowX: 'auto', mb: 2 }}>
                                <table>{children}</table>
                            </Box>
                        ),
                        a: ({ href, children }) => (
                            <MuiLink href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel="noopener">
                                {children}
                            </MuiLink>
                        ),
                    }}
                >
                    {texto}
                </ReactMarkdown>
            </div>
        </Box>
    </Box>
)

export default AyudaPage
