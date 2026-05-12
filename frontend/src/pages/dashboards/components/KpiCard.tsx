import React from 'react';
import { Box, Card, CardContent, Stack, Typography } from '@mui/material';

interface KpiCardProps {
    label: string;
    value: string;
    hint?: string;
    icon?: React.ReactNode;
    color?: 'primary' | 'success' | 'warning' | 'error' | 'info' | 'default';
}

const colorMap = {
    primary: 'primary.main',
    success: 'success.main',
    warning: 'warning.main',
    error: 'error.main',
    info: 'info.main',
    default: 'text.primary',
};

const KpiCard: React.FC<KpiCardProps> = ({ label, value, hint, icon, color = 'default' }) => {
    return (
        <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
            <CardContent>
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                    <Box flex={1} minWidth={0}>
                        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                            {label}
                        </Typography>
                        <Typography
                            variant="h5"
                            fontWeight={700}
                            sx={{ color: colorMap[color], mt: 0.5, wordBreak: 'break-word' }}
                        >
                            {value}
                        </Typography>
                        {hint && (
                            <Typography variant="caption" color="text.secondary">
                                {hint}
                            </Typography>
                        )}
                    </Box>
                    {icon && (
                        <Box sx={{ color: 'text.secondary', opacity: 0.6 }}>{icon}</Box>
                    )}
                </Stack>
            </CardContent>
        </Card>
    );
};

export default KpiCard;
