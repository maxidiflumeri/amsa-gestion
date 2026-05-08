import React, { useEffect } from 'react';
import { Box, Typography, Button, Divider } from '@mui/material';
import { usePageMeta, BreadcrumbItem, PageAction } from '../../context/PageMetaContext';

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    breadcrumbs?: BreadcrumbItem[];
    actions?: PageAction[];
    divider?: boolean;
}

const PageHeader: React.FC<PageHeaderProps> = ({
    title,
    subtitle,
    breadcrumbs,
    actions,
    divider = false,
}) => {
    const { setPageMeta, clearPageMeta } = usePageMeta();

    useEffect(() => {
        setPageMeta({
            title,
            breadcrumbs: breadcrumbs ?? [],
            actions: actions ?? [],
        });
        document.title = `${title} — AMSA Gestión`;

        return () => {
            clearPageMeta();
        };
    }, [title]);

    return (
        <Box sx={{ mb: 3 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: { sm: 'center' },
                    flexDirection: { xs: 'column', sm: 'row' },
                    gap: 2,
                    justifyContent: 'space-between',
                }}
            >
                <Box>
                    <Typography variant="h4" component="h1" fontWeight={700}>
                        {title}
                    </Typography>
                    {subtitle && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {subtitle}
                        </Typography>
                    )}
                </Box>

                {actions && actions.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                        {actions.map((action, i) => (
                            <Button
                                key={i}
                                variant={action.variant ?? 'contained'}
                                onClick={action.onClick}
                                disabled={action.disabled}
                                startIcon={action.startIcon}
                                size="small"
                            >
                                {action.label}
                            </Button>
                        ))}
                    </Box>
                )}
            </Box>

            {divider && <Divider sx={{ mt: 2 }} />}
        </Box>
    );
};

export default PageHeader;
