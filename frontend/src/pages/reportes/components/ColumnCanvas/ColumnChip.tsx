import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Box, Chip, IconButton, Stack, Typography } from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import CloseIcon from '@mui/icons-material/Close'
import { Columna } from '../../../../types/reportes'

type ColumnChipProps = {
  columna: Columna
  isSelected: boolean
  onSelect: () => void
  onRemove: () => void
}

const ColumnChip = ({ columna, isSelected, onSelect, onRemove }: ColumnChipProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columna.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const getTipoColor = (tipo?: string) => {
    switch (tipo) {
      case 'numero':
      case 'moneda':
        return 'success'
      case 'fecha':
        return 'info'
      case 'boolean':
        return 'warning'
      default:
        return 'default'
    }
  }

  return (
    <Box
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      sx={{
        p: 1.5,
        mb: 1,
        bgcolor: isSelected ? 'action.selected' : 'background.paper',
        border: 1,
        borderColor: isSelected ? 'primary.main' : 'divider',
        borderRadius: 1,
        cursor: 'pointer',
        '&:hover': {
          bgcolor: isSelected ? 'action.selected' : 'action.hover',
        },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box {...attributes} {...listeners} sx={{ cursor: 'grab', display: 'flex', alignItems: 'center' }}>
          <DragIndicatorIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        </Box>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={isSelected ? 600 : 400} noWrap>
            {columna.label}
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Chip label={columna.path} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.7rem' }} />
            {columna.tipo && (
              <Chip
                label={columna.tipo}
                size="small"
                color={getTipoColor(columna.tipo)}
                sx={{ height: 18, fontSize: '0.7rem' }}
              />
            )}
          </Stack>
        </Box>

        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onRemove() }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  )
}

export default ColumnChip
