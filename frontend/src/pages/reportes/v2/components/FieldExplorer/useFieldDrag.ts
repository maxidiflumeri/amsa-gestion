import { useDraggable } from '@dnd-kit/core'
import { NodoCatalogo } from '../../../../../types/reportes-v2'

export const useFieldDrag = (nodo: NodoCatalogo) => {
  const draggable = useDraggable({
    id: nodo.path,
    data: { nodo },
    disabled: nodo.tipo !== 'escalar',
  })

  return draggable
}
