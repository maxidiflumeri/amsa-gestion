import { Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Paper, useTheme } from '@mui/material'

type PreviewTableProps = {
  columnas: any[]
  filas: any[]
}

const PreviewTable = ({ columnas, filas }: PreviewTableProps) => {
  const theme = useTheme()

  if (columnas.length === 0 || filas.length === 0) return null

  const columnKeys = Object.keys(filas[0] || {})

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
          {filas.map((fila, idx) => (
            <TableRow key={idx} hover>
              {columnKeys.map(key => (
                <TableCell key={key} sx={{ whiteSpace: 'nowrap' }}>
                  {fila[key] !== null && fila[key] !== undefined ? String(fila[key]) : ''}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

export default PreviewTable
