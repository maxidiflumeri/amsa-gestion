import React from 'react'
import { Box, Link as MuiLink } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown de la ayuda con los componentes de MUI, para que no parezca pegada de otro lado.
 * Las tablas anchas scrollean solas en vez de romper el layout.
 *
 * Lo usan el visor de `/ayuda` y el panel contextual del botón "?". En el panel importa que los
 * enlaces internos **no recarguen la página**: el usuario está en medio de una pantalla y perdería
 * lo que tenga a medio hacer. Por eso `onNavegarInterno`, que deja al panel resolver un enlace a
 * otra página de ayuda sin salir de donde está.
 */
const Markdown: React.FC<{
    texto: string
    /** Si está, los enlaces a `/ayuda/...` llaman a esto con el slug en vez de navegar. */
    onNavegarInterno?: (slug: string) => void
    /**
     * Tipografía y márgenes de un panel angosto (el asistente): `body2`, párrafos y listas apretados, títulos chicos.
     * También saca las imágenes: el texto lo escribe un modelo y no debe poder cargar nada de afuera.
     */
    compacto?: boolean
    /**
     * Si está, decide cómo se dibuja CADA enlace (con su destino y su contenido). El asistente lo usa para que solo
     * los `/ayuda/<slug>` que existen sean clicables y todo lo demás quede como texto plano.
     */
    onEnlace?: (href: string, hijos: React.ReactNode) => React.ReactNode
}> = ({ texto, onNavegarInterno, compacto = false, onEnlace }) => (
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
            // `&&` sube la especificidad: pisa solo lo que se nombra y deja el resto (el scroll del código, el borde de la cita) como está.
            ...(compacto && {
                '&& h1, && h2, && h3': { typography: 'subtitle2', fontWeight: 700, mt: 1.5, mb: 0.5 },
                '&& p': { typography: 'body2', lineHeight: 1.6, mb: 1, '&:last-child': { mb: 0 } },
                '&& li': { typography: 'body2', lineHeight: 1.6, mb: 0.25 },
                '&& ol, && ul': { pl: 2.5, mb: 1, mt: 0.5 },
                '&& pre': { p: 1, mb: 1, maxWidth: '100%' },
                '&& blockquote': { px: 1.5, mb: 1 },
                '&& hr': { my: 1.5 },
                overflowWrap: 'anywhere',
                minWidth: 0,
            }),
        }}
    >
        <Box sx={{ '& > div:first-of-type > *:first-of-type': { mt: 0 } }}>
            <div>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        ...(compacto && { img: () => null }),
                        table: ({ children }) => (
                            <Box sx={{ overflowX: 'auto', mb: 2 }}>
                                <table>{children}</table>
                            </Box>
                        ),
                        a: ({ href, children }) => {
                            if (onEnlace) return <>{onEnlace(href ?? '', children)}</>
                            const externo = !!href && /^[a-z]+:/i.test(href)
                            if (externo) {
                                return (
                                    <MuiLink href={href} target="_blank" rel="noopener">
                                        {children}
                                    </MuiLink>
                                )
                            }
                            const slugAyuda = href?.startsWith('/ayuda/') ? href.slice('/ayuda/'.length) : null
                            if (slugAyuda && onNavegarInterno) {
                                return (
                                    <MuiLink
                                        component="button"
                                        type="button"
                                        onClick={() => onNavegarInterno(slugAyuda)}
                                        sx={{ verticalAlign: 'baseline' }}
                                    >
                                        {children}
                                    </MuiLink>
                                )
                            }
                            // Enlace interno normal: React Router, para no recargar la app entera.
                            return (
                                <MuiLink component={RouterLink} to={href ?? '#'}>
                                    {children}
                                </MuiLink>
                            )
                        },
                    }}
                >
                    {texto}
                </ReactMarkdown>
            </div>
        </Box>
    </Box>
)

export default Markdown
