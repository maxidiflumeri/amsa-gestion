import React from 'react';
import {
    Box,
    Card,
    CardContent,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';

export interface DataTableColumn<T = Record<string, unknown>> {
    key: string;
    label: string;
    render?: (row: T) => React.ReactNode;
    /** Columna que actúa como título principal en vista mobile */
    primary?: boolean;
    /** Columna que actúa como subtítulo en vista mobile */
    secondary?: boolean;
    /** No mostrar en modo mobile card */
    hideInCard?: boolean;
    align?: 'left' | 'center' | 'right';
    width?: number | string;
}

interface DataTableResponsiveProps<T extends Record<string, unknown>> {
    columns: DataTableColumn<T>[];
    rows: T[];
    rowKey?: (row: T) => string;
    emptyMessage?: string;
    onRowClick?: (row: T) => void;
}

function DataTableResponsive<T extends Record<string, unknown>>({
    columns,
    rows,
    rowKey,
    emptyMessage = 'No hay datos para mostrar',
    onRowClick,
}: DataTableResponsiveProps<T>) {
    const theme = useTheme();
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

    const getKey = (row: T, index: number) => rowKey ? rowKey(row) : String(index);
    const getCellValue = (col: DataTableColumn<T>, row: T) =>
        col.render ? col.render(row) : String(row[col.key] ?? '—');

    const primaryCol = columns.find((c) => c.primary);
    const secondaryCol = columns.find((c) => c.secondary);
    const detailCols = columns.filter((c) => !c.primary && !c.secondary && !c.hideInCard);

    if (rows.length === 0) {
        return (
            <Box sx={{ textAlign: 'center', py: 6 }}>
                <Typography variant="body2" color="text.secondary">
                    {emptyMessage}
                </Typography>
            </Box>
        );
    }

    // Desktop: tabla MUI normal
    if (isDesktop) {
        return (
            <Table size="small">
                <TableHead>
                    <TableRow>
                        {columns.map((col) => (
                            <TableCell
                                key={col.key}
                                align={col.align ?? 'left'}
                                width={col.width}
                            >
                                {col.label}
                            </TableCell>
                        ))}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {rows.map((row, idx) => (
                        <TableRow
                            key={getKey(row, idx)}
                            hover={Boolean(onRowClick)}
                            onClick={onRowClick ? () => onRowClick(row) : undefined}
                            sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
                        >
                            {columns.map((col) => (
                                <TableCell key={col.key} align={col.align ?? 'left'}>
                                    {getCellValue(col, row)}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        );
    }

    // Mobile: lista de Cards
    return (
        <Stack spacing={1.5}>
            {rows.map((row, idx) => (
                <Card
                    key={getKey(row, idx)}
                    variant="outlined"
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    sx={{
                        cursor: onRowClick ? 'pointer' : 'default',
                        '&:hover': onRowClick ? { boxShadow: 2 } : undefined,
                    }}
                >
                    <CardContent sx={{ pb: '12px !important' }}>
                        {primaryCol && (
                            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                                {getCellValue(primaryCol, row)}
                            </Typography>
                        )}
                        {secondaryCol && (
                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                {getCellValue(secondaryCol, row)}
                            </Typography>
                        )}
                        {detailCols.length > 0 && (
                            <Box
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: 1,
                                    mt: 1,
                                }}
                            >
                                {detailCols.map((col) => (
                                    <Box key={col.key}>
                                        <Typography variant="caption" color="text.disabled" display="block">
                                            {col.label}
                                        </Typography>
                                        <Typography variant="body2">
                                            {getCellValue(col, row)}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </CardContent>
                </Card>
            ))}
        </Stack>
    );
}

export default DataTableResponsive;
