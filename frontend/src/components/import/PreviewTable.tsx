import React, { useMemo } from "react";
import {
    Box,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Chip,
    TablePagination,
    Alert,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

interface PreviewRow {
    row: number;
    data: Record<string, any> | null;
    error: string | null;
}

interface Props {
    preview: PreviewRow[];
    total: number;
    ok: number;
    err: number;
}

export default function PreviewTable({ preview, total, ok, err }: Props) {
    const [page, setPage] = React.useState(0);
    const [rowsPerPage, setRowsPerPage] = React.useState(10);

    // Detectar columnas de datos desde las filas exitosas
    const columns = useMemo(() => {
        const cols = new Set<string>();
        for (const item of preview) {
            if (item.data) {
                for (const key of Object.keys(item.data)) {
                    if (key !== "camposAdicionales") {
                        cols.add(key);
                    }
                }
            }
        }
        return Array.from(cols);
    }, [preview]);

    const paginatedRows = preview.slice(
        page * rowsPerPage,
        page * rowsPerPage + rowsPerPage
    );

    const formatValue = (val: any): string => {
        if (val === null || val === undefined) return "—";
        if (val instanceof Date) return new Date(val).toLocaleDateString();
        if (typeof val === "object") return JSON.stringify(val);
        return String(val);
    };

    return (
        <Box>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                Vista previa (muestra de {preview.length} filas de {total})
            </Typography>

            {/* Resumen */}
            <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
                <Chip
                    label={`Total: ${total}`}
                    variant="outlined"
                    sx={{ fontWeight: 500 }}
                />
                <Chip
                    icon={<CheckCircleOutlineIcon />}
                    label={`OK: ${ok}`}
                    color="success"
                    variant="outlined"
                    sx={{ fontWeight: 500 }}
                />
                {err > 0 && (
                    <Chip
                        icon={<ErrorOutlineIcon />}
                        label={`Errores: ${err}`}
                        color="error"
                        variant="outlined"
                        sx={{ fontWeight: 500 }}
                    />
                )}
            </Box>

            {err > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Se detectaron {err} filas con errores. Podés continuar
                    con la importación — las filas con error serán omitidas
                    y quedarán registradas para su revisión.
                </Alert>
            )}

            {/* Tabla */}
            <TableContainer
                component={Paper}
                variant="outlined"
                sx={{ maxHeight: 400 }}
            >
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 700, minWidth: 60 }}>
                                #
                            </TableCell>
                            <TableCell sx={{ fontWeight: 700, minWidth: 80 }}>
                                Estado
                            </TableCell>
                            {columns.map((col) => (
                                <TableCell
                                    key={col}
                                    sx={{
                                        fontWeight: 700,
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {col}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {paginatedRows.map((item) => (
                            <TableRow
                                key={item.row}
                                sx={{
                                    bgcolor: item.error
                                        ? "error.main"
                                        : undefined,
                                    "& td": item.error
                                        ? { color: "error.contrastText" }
                                        : undefined,
                                    opacity: item.error ? 0.9 : 1,
                                }}
                            >
                                <TableCell>{item.row + 1}</TableCell>
                                <TableCell>
                                    {item.error ? (
                                        <Chip
                                            size="small"
                                            label="Error"
                                            color="error"
                                            sx={{ fontWeight: 500 }}
                                        />
                                    ) : (
                                        <Chip
                                            size="small"
                                            label="OK"
                                            color="success"
                                            sx={{ fontWeight: 500 }}
                                        />
                                    )}
                                </TableCell>
                                {columns.map((col) => (
                                    <TableCell key={col}>
                                        {item.error
                                            ? col === columns[0]
                                                ? item.error
                                                : ""
                                            : formatValue(
                                                  item.data?.[col]
                                              )}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <TablePagination
                component="div"
                count={preview.length}
                page={page}
                onPageChange={(_, p) => setPage(p)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => {
                    setRowsPerPage(parseInt(e.target.value, 10));
                    setPage(0);
                }}
                rowsPerPageOptions={[5, 10, 25, 50]}
                labelRowsPerPage="Filas por página"
            />
        </Box>
    );
}
