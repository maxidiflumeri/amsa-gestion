import { useDraggable } from '@dnd-kit/core'
import { Box, Chip, Typography } from '@mui/material'
import { NodoCatalogo } from '../../../../../types/reportes-v2'

type FieldNodeProps = {
  nodo: NodoCatalogo
}

const FieldNode = ({ nodo }: FieldNodeProps) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: nodo.path,
    data: { nodo },
    disabled: nodo.tipo !== 'escalar',
  })

  const isRelation1N = nodo.tipo === 'relacion-1-n'

  return (
    <Box
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      sx={{
        p: 1,
        cursor: nodo.tipo === 'escalar' ? 'grab' : 'default',
        opacity: isDragging ? 0.5 : 1,
        '&:hover': nodo.tipo === 'escalar' ? {
          bgcolor: 'action.hover',
        } : {},
      }}
    >
      <Typography variant="body2" component="span">
        {nodo.label}
      </Typography>
      {isRelation1N && (
        <Chip label="1:N" size="small" color="info" sx={{ ml: 1, height: 18, fontSize: '0.7rem' }} />
      )}
    </Box>
  )
}

export default FieldNode
