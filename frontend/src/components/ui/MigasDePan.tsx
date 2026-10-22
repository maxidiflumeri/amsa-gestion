import React from 'react';
import { Breadcrumbs, Link, Typography } from '@mui/material';
import { ChevronRight } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import type { BreadcrumbItem } from '../../context/PageMetaContext';

/**
 * Las migas de pan de una pantalla, arriba de su título (las dibuja `PageHeader`). Antes iban en la barra superior;
 * ahora la barra es la misma en todas las pantallas y lo propio de cada una va con su encabezado, alineado con él.
 */
const MigasDePan: React.FC<{ items: BreadcrumbItem[] }> = ({ items }) => {
    if (items.length === 0) return null;

    return (
        <Breadcrumbs
            separator={<ChevronRight size={14} aria-hidden />}
            aria-label="Migas de pan"
            sx={{ mb: 0.75, color: 'text.secondary', '& .MuiBreadcrumbs-ol': { flexWrap: 'wrap' } }}
        >
            {items.map((crumb, index) =>
                crumb.href && index < items.length - 1 ? (
                    <Link
                        key={crumb.href}
                        component={RouterLink}
                        to={crumb.href}
                        color="inherit"
                        variant="body2"
                        underline="hover"
                        sx={{ fontSize: '0.8125rem' }}
                    >
                        {crumb.label}
                    </Link>
                ) : (
                    <Typography
                        key={index}
                        variant="body2"
                        color={index === items.length - 1 ? 'text.primary' : 'text.secondary'}
                        fontWeight={index === items.length - 1 ? 600 : 400}
                        sx={{ fontSize: '0.8125rem' }}
                        aria-current={index === items.length - 1 ? 'page' : undefined}
                    >
                        {crumb.label}
                    </Typography>
                ),
            )}
        </Breadcrumbs>
    );
};

export default MigasDePan;
