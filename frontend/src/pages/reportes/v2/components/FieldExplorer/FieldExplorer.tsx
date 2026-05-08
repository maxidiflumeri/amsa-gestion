import { useState, useMemo } from 'react'
import { Box, TextField, Paper, Typography, CircularProgress } from '@mui/material'
import { RichTreeView } from '@mui/x-tree-view/RichTreeView'
import { TreeItem } from '@mui/x-tree-view/TreeItem'
import { NodoCatalogo } from '../../../../../types/reportes-v2'
import FieldNode from './FieldNode'

type FieldExplorerProps = {
  catalogo: NodoCatalogo[]
  loading: boolean
  onAddColumn: (path: string, label: string, tipo?: string) => void
}

type TreeNode = {
  id: string
  label: string
  children?: TreeNode[]
  nodo: NodoCatalogo
}

const FieldExplorer = ({ catalogo, loading, onAddColumn }: FieldExplorerProps) => {
  const [searchTerm, setSearchTerm] = useState('')

  const buildTree = (nodos: NodoCatalogo[], parentPath = ''): TreeNode[] => {
    return nodos
      .filter(n => !n.oculto)
      .map(nodo => ({
        id: nodo.path,
        label: nodo.label,
        nodo,
        children: nodo.hijos ? buildTree(nodo.hijos, nodo.path) : undefined,
      }))
  }

  const filterTree = (nodes: TreeNode[], term: string): TreeNode[] => {
    if (!term) return nodes

    const lowerTerm = term.toLowerCase()

    return nodes
      .map(node => {
        const matchesLabel = node.label.toLowerCase().includes(lowerTerm)
        const matchesPath = node.id.toLowerCase().includes(lowerTerm)
        const filteredChildren = node.children ? filterTree(node.children, term) : []

        if (matchesLabel || matchesPath || filteredChildren.length > 0) {
          return {
            ...node,
            children: filteredChildren.length > 0 ? filteredChildren : node.children,
          }
        }

        return null
      })
      .filter(Boolean) as TreeNode[]
  }

  const treeData = useMemo(() => buildTree(catalogo), [catalogo])
  const filteredTree = useMemo(() => filterTree(treeData, searchTerm), [treeData, searchTerm])

  const handleDoubleClick = (nodo: NodoCatalogo) => {
    if (nodo.tipo === 'escalar') {
      onAddColumn(nodo.path, nodo.label, nodo.tipoEscalar)
    }
  }

  if (loading) {
    return (
      <Paper sx={{ p: 3, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Paper>
    )
  }

  return (
    <Paper sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h6" gutterBottom>
        Explorador de campos
      </Typography>

      <TextField
        size="small"
        placeholder="Buscar campo..."
        fullWidth
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        sx={{ mb: 2 }}
      />

      <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
        {filteredTree.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No se encontraron campos
          </Typography>
        ) : (
          <RichTreeView
            items={filteredTree}
            slots={{ item: (props: any) => (
              <TreeItem
                {...props}
                onDoubleClick={() => handleDoubleClick(filteredTree.find(n => n.id === props.itemId)?.nodo!)}
              />
            ) }}
          />
        )}
      </Box>
    </Paper>
  )
}

export default FieldExplorer
