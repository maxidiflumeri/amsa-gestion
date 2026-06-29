import React, { useEffect, useState } from 'react'
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    MenuItem,
    Stack,
    Typography,
} from '@mui/material'
import type { EmpresaOpt } from './ClonarPlantillaDialog'

interface Props {
    open: boolean
    onClose: () => void
    empresaActualId: number | null
    empresas: EmpresaOpt[]
    /** Reportes permiten plantilla "Global" (sin empresa). Importación no. */
    permitirGlobal?: boolean
    onConfirm: (empresaId: number | null) => Promise<void> | void
}

const GLOBAL = '__global__'

/** Diálogo reutilizable para reasignar una plantilla a otra empresa. */
const CambiarEmpresaDialog: React.FC<Props> = ({
    open,
    onClose,
    empresaActualId,
    empresas,
    permitirGlobal = false,
    onConfirm,
}) => {
    const [empresaSel, setEmpresaSel] = useState<string>('')
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (open) {
            setEmpresaSel(
                empresaActualId == null
                    ? permitirGlobal ? GLOBAL : ''
                    : String(empresaActualId),
            )
        }
    }, [open, empresaActualId, permitirGlobal])

    const handleConfirm = async () => {
        const empresaId = empresaSel === GLOBAL ? null : Number(empresaSel)
        setSubmitting(true)
        try {
            await onConfirm(empresaId)
        } finally {
            setSubmitting(false)
        }
    }

    const destino = empresaSel === GLOBAL ? null : empresaSel === '' ? undefined : Number(empresaSel)
    const sinCambio = destino !== undefined && destino === empresaActualId
    const sinEmpresa = empresaSel === ''

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Cambiar de empresa</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                        Reasigná esta plantilla a otra empresa. Solo está disponible mientras la
                        plantilla no se haya usado.
                    </Typography>
                    <TextField
                        select
                        label="Empresa destino"
                        value={empresaSel}
                        onChange={(e) => setEmpresaSel(e.target.value)}
                        fullWidth
                    >
                        {permitirGlobal && (
                            <MenuItem value={GLOBAL}>
                                <em>Global (sin empresa)</em>
                            </MenuItem>
                        )}
                        {empresas.map((e) => (
                            <MenuItem key={e.id} value={String(e.id)}>
                                {e.nombre}
                            </MenuItem>
                        ))}
                    </TextField>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} color="inherit">
                    Cancelar
                </Button>
                <Button
                    onClick={handleConfirm}
                    variant="contained"
                    disabled={submitting || sinEmpresa || sinCambio}
                >
                    Cambiar
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default CambiarEmpresaDialog
