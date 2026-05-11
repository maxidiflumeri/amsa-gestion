import React from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';

interface Props {
    before?: Record<string, any> | null;
    after?: Record<string, any> | null;
    extra?: Record<string, any> | null;
}

function isObject(v: any): v is Record<string, any> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function flat(obj: Record<string, any> | null | undefined, prefix = ''): Record<string, any> {
    if (!obj || !isObject(obj)) return {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (isObject(v)) Object.assign(out, flat(v, key));
        else out[key] = v;
    }
    return out;
}

const Pill: React.FC<{ kind: 'added' | 'removed' | 'changed' | 'same'; children?: React.ReactNode }> = ({ kind, children }) => {
    const color = kind === 'added' ? 'success' : kind === 'removed' ? 'error' : kind === 'changed' ? 'warning' : 'default';
    const label = kind === 'added' ? 'nuevo' : kind === 'removed' ? 'eliminado' : kind === 'changed' ? 'cambiado' : 'igual';
    return <Chip size="small" color={color as any} label={children ?? label} sx={{ ml: 1 }} />;
};

const AuditDiffView: React.FC<Props> = ({ before, after, extra }) => {
    const fb = flat(before);
    const fa = flat(after);
    const keys = Array.from(new Set([...Object.keys(fb), ...Object.keys(fa)])).sort();

    return (
        <Box>
            {extra && Object.keys(extra).length > 0 && (
                <Box mb={2}>
                    <Typography variant="subtitle2" gutterBottom>Contexto / parámetros</Typography>
                    <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 12, overflowX: 'auto' }}>
                        {JSON.stringify(extra, null, 2)}
                    </pre>
                </Box>
            )}

            {keys.length === 0 ? (
                <Typography color="text.secondary">No hay snapshot before/after registrado.</Typography>
            ) : (
                <Box>
                    <Typography variant="subtitle2" gutterBottom>Cambios</Typography>
                    <Stack spacing={0.5}>
                        {keys.map((k) => {
                            const vb = fb[k];
                            const va = fa[k];
                            const hadBefore = k in fb;
                            const hasAfter = k in fa;
                            const kind = !hadBefore && hasAfter
                                ? 'added'
                                : hadBefore && !hasAfter
                                    ? 'removed'
                                    : vb !== va
                                        ? 'changed'
                                        : 'same';
                            if (kind === 'same') return null;
                            return (
                                <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 1, fontFamily: 'monospace', fontSize: 13 }}>
                                    <Box sx={{ minWidth: 220, fontWeight: 600 }}>{k}</Box>
                                    <Box sx={{ flex: 1, textDecoration: kind === 'removed' ? 'line-through' : 'none', color: kind === 'removed' ? 'error.main' : 'text.secondary' }}>
                                        {hadBefore ? JSON.stringify(vb) : '—'}
                                    </Box>
                                    <Box>→</Box>
                                    <Box sx={{ flex: 1, color: kind === 'added' ? 'success.main' : kind === 'changed' ? 'warning.main' : 'text.primary' }}>
                                        {hasAfter ? JSON.stringify(va) : '—'}
                                    </Box>
                                    <Pill kind={kind as any} />
                                </Box>
                            );
                        })}
                    </Stack>
                </Box>
            )}
        </Box>
    );
};

export default AuditDiffView;
