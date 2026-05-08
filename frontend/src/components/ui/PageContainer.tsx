import React from 'react';
import { Box, BoxProps } from '@mui/material';

interface PageContainerProps extends BoxProps {
    maxWidth?: number | string;
}

const PageContainer: React.FC<PageContainerProps> = ({
    children,
    maxWidth = 1280,
    sx,
    ...props
}) => {
    return (
        <Box
            sx={{
                width: '100%',
                maxWidth,
                mx: 'auto',
                px: { xs: 2, sm: 3, md: 4 },
                py: { xs: 2, sm: 3 },
                ...sx,
            }}
            {...props}
        >
            {children}
        </Box>
    );
};

export default PageContainer;
