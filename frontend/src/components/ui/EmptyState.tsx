import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import InboxIcon from '@mui/icons-material/Inbox';

interface EmptyStateProps {
    title?: string;
    description?: string;
    icon?: React.ReactNode;
    action?: {
        label: string;
        onClick: () => void;
    };
}

const EmptyState: React.FC<EmptyStateProps> = ({
    title = 'No hay datos',
    description,
    icon,
    action,
}) => {
    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                py: 8,
                px: 3,
                textAlign: 'center',
            }}
        >
            <Box
                sx={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    bgcolor: 'action.hover',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mb: 2,
                    color: 'text.disabled',
                    '& svg': { fontSize: 32 },
                }}
            >
                {icon ?? <InboxIcon />}
            </Box>

            <Typography variant="h6" fontWeight={600} gutterBottom>
                {title}
            </Typography>

            {description && (
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
                    {description}
                </Typography>
            )}

            {action && (
                <Button variant="contained" onClick={action.onClick} sx={{ mt: 3 }}>
                    {action.label}
                </Button>
            )}
        </Box>
    );
};

export default EmptyState;
