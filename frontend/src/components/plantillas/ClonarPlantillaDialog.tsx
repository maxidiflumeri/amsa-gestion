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
} from '@mui/material'

export interface EmpresaOpt {
    id: number
    nombre: string
}

interface Props {
    open: boolean
    onClose: () => void
    nombreActual: string
    empresaActualId: number | null
    empresas: EmpresaOpt[]
    /** Reportes permiten plantilla "Global" (sin empresa). Importación no. */
    permitirGlobal?: boolean
    onConfirm: (data: { nombre: string; empresaId: number | null }) => Promise<void> | void
}

const GLOBAL = '__global__'

/** Diálogo reutilizable para clonar una plantilla (importación o reportes) eligiendo nombre y empresa destino. */
const ClonarPlantillaDialog: React.FC<Props> = ({
    open,
    onClose,
    nombreActual,
    empresaActualId,
    empresas,
    permitirGlobal = false,
    onConfirm,
}) => {
    const [nombre, setNombre] = useState('')
    const [empresaSel, setEmpresaSel] = useState<string>('')
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (open) {
            setNombre(`${nombreActual} (copia)`)
            setEmpresaSel(
                empresaActualId == null
                    ? permitirGlobal ? GLOBAL : ''
                    : String(empresaActualId),
            )
        }
    }, [open, nombreActual, empresaActualId, permitirGlobal])

    const handleConfirm = async () => {
        const empresaId = empresaSel === GLOBAL ? null : Number(empresaSel)
        setSubmitting(true)
        try {
            await onConfirm({ nombre: nombre.trim(), empresaId })
        } finally {
            setSubmitting(false)
        }
    }

    const sinNombre = !nombre.trim()
    const sinEmpresa = empresaSel === ''

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>Clonar plantilla</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <TextField
                        label="Nombre de la copia"
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        fullWidth
                        autoFocus
                    />
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
                    disabled={submitting || sinNombre || sinEmpresa}
                >
                    Clonar
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default ClonarPlantillaDialog
