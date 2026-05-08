import React from 'react';
import { Card, CardContent, CardHeader, CardProps, Typography } from '@mui/material';

interface SectionCardProps extends CardProps {
    title?: string;
    subtitle?: string;
    action?: React.ReactNode;
    noPadding?: boolean;
}

const SectionCard: React.FC<SectionCardProps> = ({
    title,
    subtitle,
    action,
    noPadding = false,
    children,
    sx,
    ...props
}) => {
    return (
        <Card
            variant="outlined"
            sx={{
                borderRadius: 2,
                ...sx,
            }}
            {...props}
        >
            {(title || action) && (
                <CardHeader
                    title={
                        title ? (
                            <Typography variant="h6" fontWeight={600}>
                                {title}
                            </Typography>
                        ) : undefined
                    }
                    subheader={
                        subtitle ? (
                            <Typography variant="body2" color="text.secondary">
                                {subtitle}
                            </Typography>
                        ) : undefined
                    }
                    action={action}
                    sx={{ pb: 0 }}
                />
            )}
            <CardContent sx={noPadding ? { p: '0 !important' } : undefined}>
                {children}
            </CardContent>
        </Card>
    );
};

export default SectionCard;
