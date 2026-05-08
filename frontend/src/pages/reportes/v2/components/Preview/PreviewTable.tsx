import { Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Paper, useTheme, alpha } from '@mui/material'

type PreviewTableProps = {
  columnas: string[]
  filas: any[]
}

type FilaConSubtotales = {
  tipo: 'dato' | 'subtotal' | 'total' | 'cabecera'
  nivel?: number
  grupoLabel?: string
  datos: Record<string, any>
}

const isFilaConSubtotales = (fila: any): fila is FilaConSubtotales =>
  fila && typeof fila === 'object' && 'tipo' in fila && 'datos' in fila &&
  ['dato', 'subtotal', 'total', 'cabecera'].includes(fila.tipo)

const PreviewTable = ({ columnas, filas }: PreviewTableProps) => {
  const theme = useTheme()

  if (filas.length === 0) return null

  const wrapped = isFilaConSubtotales(filas[0])
  const columnKeys = columnas && columnas.length > 0
    ? columnas
    : Object.keys((wrapped ? filas[0].datos : filas[0]) || {})

  const numberFormatter = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const renderCell = (val: any) => {
    if (val === null || val === undefined) return ''
    if (typeof val === 'number') return numberFormatter.format(val)
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  return (
    <TableContainer component={Paper} sx={{ maxHeight: 500, border: `1px solid ${theme.palette.divider}` }}>
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            {columnKeys.map(key => (
              <TableCell
                key={key}
                sx={{
                  bgcolor: theme.palette.background.default,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {key}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {filas.map((fila, idx) => {
            if (!wrapped) {
              return (
                <TableRow key={idx} hover>
                  {columnKeys.map(key => (
                    <TableCell key={key} sx={{ whiteSpace: 'nowrap' }}>
                      {renderCell(fila[key])}
                    </TableCell>
                  ))}
                </TableRow>
              )
            }

            const f = fila as FilaConSubtotales
            const isCabecera = f.tipo === 'cabecera'
            const isSubtotal = f.tipo === 'subtotal'
            const isTotal = f.tipo === 'total'

            if (isCabecera) {
              return (
                <TableRow key={idx} sx={{ bgcolor: alpha(theme.palette.info.main, 0.12) }}>
                  <TableCell
                    colSpan={columnKeys.length}
                    sx={{ whiteSpace: 'nowrap', fontWeight: 700, color: theme.palette.info.dark }}
                  >
                    {f.grupoLabel}
                  </TableCell>
                </TableRow>
              )
            }

            if (isSubtotal || isTotal) {
              const rowSx = isTotal
                ? { bgcolor: alpha(theme.palette.primary.main, 0.15) }
                : { bgcolor: alpha(theme.palette.primary.main, 0.06), fontStyle: 'italic' }
              return (
                <TableRow key={idx} sx={rowSx}>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
                    {f.grupoLabel || (isTotal ? 'TOTAL GENERAL' : 'Subtotal')}
                  </TableCell>
                  {columnKeys.slice(1).map(key => (
                    <TableCell key={key} sx={{ whiteSpace: 'nowrap', fontWeight: isTotal ? 700 : 600 }}>
                      {renderCell(f.datos[key])}
                    </TableCell>
                  ))}
                </TableRow>
              )
            }

            return (
              <TableRow key={idx} hover>
                {columnKeys.map(key => (
                  <TableCell key={key} sx={{ whiteSpace: 'nowrap' }}>
                    {renderCell(f.datos[key])}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

export default PreviewTable
