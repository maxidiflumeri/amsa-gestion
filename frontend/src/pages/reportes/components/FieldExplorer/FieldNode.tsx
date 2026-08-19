import { useDraggable } from '@dnd-kit/core'
import { Box, Chip, Typography } from '@mui/material'
import { NodoCatalogo } from '../../../../types/reportes'

type FieldNodeProps = {
  nodo: NodoCatalogo
  onDoubleClick?: () => void
}

const FieldNode = ({ nodo, onDoubleClick }: FieldNodeProps) => {
  const isEscalar = nodo.tipo === 'escalar'

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: nodo.path,
    data: { nodo },
    disabled: !isEscalar,
  })

  return (
    <Box
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onDoubleClick={isEscalar ? onDoubleClick : undefined}
      sx={{
        py: 0.5,
        px: 1,
        borderRadius: 0.5,
        cursor: isEscalar ? 'grab' : 'default',
        opacity: isDragging ? 0.5 : 1,
        userSelect: 'none',
        '&:hover': isEscalar
          ? {
              bgcolor: 'action.hover',
            }
          : {},
      }}
    >
      <Typography variant="body2" component="span">
        {nodo.label}
      </Typography>
      {nodo.tipoEscalar && (
        <Typography variant="caption" component="span" sx={{ ml: 1, color: 'text.disabled' }}>
          {nodo.tipoEscalar}
        </Typography>
      )}
      {/* Los campos que se entienden por el nombre no traen descripción: ahí no se dibuja nada. */}
      {nodo.descripcion && (
        <Typography
          variant="caption"
          component="div"
          sx={{ color: 'text.secondary', lineHeight: 1.3, mt: 0.25 }}
        >
          {nodo.descripcion}
        </Typography>
      )}
    </Box>
  )
}

export default FieldNode
