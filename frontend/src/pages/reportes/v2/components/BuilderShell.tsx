import { useState, ReactNode } from 'react'
import { DndContext, DragOverlay, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { Grid, Box, Chip } from '@mui/material'
import { ColumnaV2, NodoCatalogo } from '../../../../types/reportes-v2'

type BuilderShellProps = {
  columnas: ColumnaV2[]
  onColumnasChange: (columnas: ColumnaV2[]) => void
  onAddColumn: (path: string, label: string, tipo?: string) => void
  children: (props: {
    isDragActive: boolean
    selectedId: string | null
    onSelectColumn: (id: string) => void
  }) => ReactNode
}

const BuilderShell = ({ columnas, onColumnasChange, onAddColumn, children }: BuilderShellProps) => {
  const [activeDrag, setActiveDrag] = useState<{ type: 'field' | 'column'; data: any } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  )

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event

    if (active.data.current?.nodo) {
      setActiveDrag({ type: 'field', data: active.data.current.nodo as NodoCatalogo })
    } else {
      const columna = columnas.find(c => c.id === active.id)
      if (columna) {
        setActiveDrag({ type: 'column', data: columna })
      }
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    setActiveDrag(null)

    if (!over) return

    if (active.data.current?.nodo) {
      const nodo = active.data.current.nodo as NodoCatalogo

      if (over.id === 'column-canvas' && nodo.tipo === 'escalar') {
        onAddColumn(nodo.path, nodo.label, nodo.tipoEscalar)
      }
    } else {
      const oldIndex = columnas.findIndex(c => c.id === active.id)
      const newIndex = columnas.findIndex(c => c.id === over.id)

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(columnas, oldIndex, newIndex)
        onColumnasChange(reordered)
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {children({
        isDragActive: activeDrag !== null,
        selectedId,
        onSelectColumn: setSelectedId,
      })}

      <DragOverlay>
        {activeDrag?.type === 'field' && (
          <Chip label={(activeDrag.data as NodoCatalogo).label} color="primary" />
        )}
        {activeDrag?.type === 'column' && (
          <Chip label={(activeDrag.data as ColumnaV2).label} color="secondary" />
        )}
      </DragOverlay>
    </DndContext>
  )
}

export default BuilderShell
