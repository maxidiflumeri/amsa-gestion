import { Route, Routes } from 'react-router-dom'
import PrivateRoute from './PrivateRoute'
import PrivateLayout from '../components/layout/PrivateLayout'
import DeudoresPage from '../pages/DeudoresPage'
import Login from '../pages/Login'
import Inicio from '../pages/Inicio'
import ImportWizard from '../pages/ImportWizard'
import PlantillaManager from '../pages/PlantillaManager'
import ImportHistory from '../pages/ImportHistory'
import ImportDetail from '../pages/ImportDetail'
import AjustesEmpresas from '../pages/ajustes/AjustesEmpresas'
import AjustesParametros from '../pages/ajustes/AjustesParametros'
import AjustesPoliticas from '../pages/ajustes/AjustesPoliticas'

const AppRoutes = () => {

    return (
        <Routes>
            <Route path="/login" element={<Login />} />

            <Route path="/" element={<PrivateRoute><PrivateLayout /></PrivateRoute>}>
                <Route index element={<Inicio />} />
                <Route path="gestion" element={<DeudoresPage />} />
                <Route path="carga" element={<ImportWizard />} />
                <Route path="plantillas" element={<PlantillaManager />} />
                <Route path="historial-importaciones" element={<ImportHistory />} />
                <Route path="historial-importaciones/:id" element={<ImportDetail />} />
                <Route path="ajustes/empresas" element={<AjustesEmpresas />} />
                <Route path="ajustes/parametros" element={<AjustesParametros />} />
                <Route path="ajustes/politicas" element={<AjustesPoliticas />} />
                {/* futuras rutas privadas */}

            </Route>
        </Routes>
    )
}

export default AppRoutes