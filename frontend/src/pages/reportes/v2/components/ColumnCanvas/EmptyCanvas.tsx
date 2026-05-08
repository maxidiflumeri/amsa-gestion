import { Box, Typography } from '@mui/material'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'

const EmptyCanvas = () => {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 300,
        color: 'text.secondary',
      }}
    >
      <ViewColumnIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
      <Typography variant="h6" gutterBottom>
        Arrastrá campos desde el explorador
      </Typography>
      <Typography variant="body2">
        o hacé doble click sobre un campo para agregarlo
      </Typography>
    </Box>
  )
}

export default EmptyCanvas
