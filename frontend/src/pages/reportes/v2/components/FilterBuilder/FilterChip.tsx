import { Chip, Box, IconButton, useTheme } from '@mui/material'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import DeleteIcon from '@mui/icons-material/Delete'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import FilterAltIcon from '@mui/icons-material/FilterAlt'
import InputIcon from '@mui/icons-material/Input'
import { FiltroV2 } from '../../../../../types/reportes-v2'
import { getOperatorLabel } from './operatorMatrix'

type FilterChipProps = {
  filtro: FiltroV2
  tipoEscalar?: string
  onClick: () => void
  onDelete: () => void
}

const FilterChip = ({ filtro, tipoEscalar, onClick, onDelete }: FilterChipProps) => {
  const theme = useTheme()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: filtro.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const formatValor = (val: any): string => {
    if (val === undefined || val === null) return ''
    if (Array.isArray(val)) {
      if (val.length === 0) return ''
      if (val.length === 2 && filtro.operador === 'between') {
        return `${val[0]} - ${val[1]}`
      }
      return val.join(', ')
    }
    if (typeof val === 'boolean') return val ? 'Sí' : 'No'
    return String(val)
  }

  const operadorLabel = getOperatorLabel(filtro.operador, tipoEscalar)
  const valorDisplay = filtro.variable
    ? `(${filtro.labelVariable})`
    : formatValor(filtro.valor) || '(sin valor)'

  const pathParts = filtro.path.split('.')
  const pathLabel = pathParts[pathParts.length - 1]

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        p: 1,
        borderRadius: 1,
        bgcolor: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        '&:hover': {
          bgcolor: theme.palette.action.hover,
        },
      }}
    >
      <Box {...attributes} {...listeners} sx={{ display: 'flex', cursor: 'grab' }}>
        <DragIndicatorIcon fontSize="small" color="action" />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {filtro.variable ? (
          <InputIcon fontSize="small" color="primary" />
        ) : (
          <FilterAltIcon fontSize="small" color="action" />
        )}
      </Box>

      <Box
        onClick={onClick}
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          cursor: 'pointer',
        }}
      >
        <Chip
          label={pathLabel}
          size="small"
          sx={{ fontSize: '0.75rem', bgcolor: theme.palette.primary.main, color: theme.palette.primary.contrastText }}
        />
        <Chip
          label={operadorLabel}
          size="small"
          sx={{ fontSize: '0.75rem' }}
        />
        <Box
          sx={{
            fontSize: '0.875rem',
            color: theme.palette.text.primary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 200,
          }}
        >
          {valorDisplay}
        </Box>
      </Box>

      <IconButton size="small" onClick={onDelete} color="error">
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

export default FilterChip
