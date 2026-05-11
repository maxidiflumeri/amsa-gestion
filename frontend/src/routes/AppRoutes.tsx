import { Route, Routes } from 'react-router-dom';
import PrivateRoute from './PrivateRoute';
import AppShell from '../components/layout/AppShell/AppShell';
import DeudoresPage from '../pages/DeudoresPage';
import Login from '../pages/Login';
import Inicio from '../pages/Inicio';
import ImportWizard from '../pages/ImportWizard';
import PlantillasList from '../pages/PlantillasList';
import PlantillaEditor from '../pages/PlantillaEditor';
import ImportHistory from '../pages/ImportHistory';
import ImportDetail from '../pages/ImportDetail';
import AjustesEmpresas from '../pages/ajustes/AjustesEmpresas';
import AjustesParametros from '../pages/ajustes/AjustesParametros';
import AjustesPoliticas from '../pages/ajustes/AjustesPoliticas';
import ReportesHome from '../pages/reportes/ReportesHome';
import ReportesWizard from '../pages/reportes/ReportesWizard';
import ReportesEjecutar from '../pages/reportes/ReportesEjecutar';
import ReportesEstadisticas from '../pages/reportes/ReportesEstadisticas';
import ReportesV2Home from '../pages/reportes/v2/ReportesV2Home';
import ReportesV2Builder from '../pages/reportes/v2/ReportesV2Builder';
import ReportesV2Ejecutar from '../pages/reportes/v2/ReportesV2Ejecutar';
import ReportesV2Ejecuciones from '../pages/reportes/v2/ReportesV2Ejecuciones';
import RolesPage from '../pages/admin/RolesPage';
import UsuariosPage from '../pages/admin/UsuariosPage';

const AppRoutes = () => {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />

            <Route path="/" element={<PrivateRoute><AppShell /></PrivateRoute>}>
                <Route index element={<Inicio />} />
                <Route path="gestion" element={<DeudoresPage />} />
                <Route path="carga" element={<ImportWizard />} />
                <Route path="plantillas" element={<PlantillasList />} />
                <Route path="plantillas/nueva" element={<PlantillaEditor />} />
                <Route path="plantillas/:id/editar" element={<PlantillaEditor />} />
                <Route path="historial-importaciones" element={<ImportHistory />} />
                <Route path="historial-importaciones/:id" element={<ImportDetail />} />
                <Route path="ajustes/empresas" element={<AjustesEmpresas />} />
                <Route path="ajustes/parametros" element={<AjustesParametros />} />
                <Route path="ajustes/politicas" element={<AjustesPoliticas />} />
                <Route path="reportes" element={<ReportesHome />} />
                <Route path="reportes/nueva" element={<ReportesWizard />} />
                <Route path="reportes/:id/editar" element={<ReportesWizard />} />
                <Route path="reportes/:id/ejecutar" element={<ReportesEjecutar />} />
                <Route path="reportes/estadisticas" element={<ReportesEstadisticas />} />
                <Route path="reportes/v2" element={<ReportesV2Home />} />
                <Route path="reportes/v2/nuevo" element={<ReportesV2Builder />} />
                <Route path="reportes/v2/:id/editar" element={<ReportesV2Builder />} />
                <Route path="reportes/v2/ejecuciones" element={<ReportesV2Ejecuciones />} />
                <Route path="reportes/v2/:id/ejecutar" element={<ReportesV2Ejecutar />} />
                <Route path="admin/roles" element={<RolesPage />} />
                <Route path="admin/usuarios" element={<UsuariosPage />} />
            </Route>
        </Routes>
    );
};

export default AppRoutes;
