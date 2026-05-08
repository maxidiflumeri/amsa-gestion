import React from 'react';
import {
    Box,
    Card,
    CardContent,
    Skeleton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
} from '@mui/material';

export type LoadingSkeletonVariant = 'table' | 'cards' | 'form' | 'detail' | 'list';

interface LoadingSkeletonProps {
    variant?: LoadingSkeletonVariant;
    rows?: number;
    columns?: number;
}

const TableSkeleton: React.FC<{ rows: number; columns: number }> = ({ rows, columns }) => (
    <Table>
        <TableHead>
            <TableRow>
                {Array.from({ length: columns }).map((_, i) => (
                    <TableCell key={i}>
                        <Skeleton variant="text" width="80%" />
                    </TableCell>
                ))}
            </TableRow>
        </TableHead>
        <TableBody>
            {Array.from({ length: rows }).map((_, rowIdx) => (
                <TableRow key={rowIdx}>
                    {Array.from({ length: columns }).map((_, colIdx) => (
                        <TableCell key={colIdx}>
                            <Skeleton variant="text" width={colIdx === 0 ? '70%' : '50%'} />
                        </TableCell>
                    ))}
                </TableRow>
            ))}
        </TableBody>
    </Table>
);

const CardsSkeleton: React.FC<{ rows: number }> = ({ rows }) => (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
        {Array.from({ length: rows }).map((_, i) => (
            <Card key={i} variant="outlined">
                <CardContent>
                    <Skeleton variant="text" width="60%" height={28} />
                    <Skeleton variant="text" width="80%" />
                    <Skeleton variant="text" width="40%" />
                    <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                        <Skeleton variant="rounded" width={80} height={32} />
                        <Skeleton variant="rounded" width={80} height={32} />
                    </Box>
                </CardContent>
            </Card>
        ))}
    </Box>
);

const FormSkeleton: React.FC<{ rows: number }> = ({ rows }) => (
    <Stack spacing={2.5}>
        {Array.from({ length: rows }).map((_, i) => (
            <Box key={i}>
                <Skeleton variant="text" width={120} height={20} sx={{ mb: 0.5 }} />
                <Skeleton variant="rounded" height={44} />
            </Box>
        ))}
        <Skeleton variant="rounded" width={120} height={40} />
    </Stack>
);

const DetailSkeleton: React.FC = () => (
    <Stack spacing={2}>
        <Skeleton variant="text" width="40%" height={36} />
        <Skeleton variant="text" width="60%" />
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 1 }}>
            {Array.from({ length: 6 }).map((_, i) => (
                <Box key={i}>
                    <Skeleton variant="text" width="40%" height={16} />
                    <Skeleton variant="text" width="70%" />
                </Box>
            ))}
        </Box>
    </Stack>
);

const ListSkeleton: React.FC<{ rows: number }> = ({ rows }) => (
    <Stack spacing={0} divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
        {Array.from({ length: rows }).map((_, i) => (
            <Box key={i} sx={{ py: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Skeleton variant="circular" width={40} height={40} />
                <Box sx={{ flexGrow: 1 }}>
                    <Skeleton variant="text" width="50%" />
                    <Skeleton variant="text" width="30%" />
                </Box>
                <Skeleton variant="rounded" width={64} height={24} />
            </Box>
        ))}
    </Stack>
);

const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
    variant = 'table',
    rows = 6,
    columns = 5,
}) => {
    switch (variant) {
        case 'table':
            return <TableSkeleton rows={rows} columns={columns} />;
        case 'cards':
            return <CardsSkeleton rows={rows} />;
        case 'form':
            return <FormSkeleton rows={rows} />;
        case 'detail':
            return <DetailSkeleton />;
        case 'list':
            return <ListSkeleton rows={rows} />;
        default:
            return <TableSkeleton rows={rows} columns={columns} />;
    }
};

export default LoadingSkeleton;
