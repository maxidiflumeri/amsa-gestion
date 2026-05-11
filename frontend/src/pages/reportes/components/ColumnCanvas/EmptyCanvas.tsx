import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import { EmptyState } from '../../../../components/ui'

const EmptyCanvas = () => {
  return (
    <EmptyState
      icon={<ViewColumnIcon />}
      title="Arrastrá campos desde el explorador"
      description="o hacé doble click sobre un campo para agregarlo"
    />
  )
}

export default EmptyCanvas
