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
import ReportesBuilder from '../pages/reportes/ReportesBuilder';
import ReportesEjecutar from '../pages/reportes/ReportesEjecutar';
import ReportesEjecuciones from '../pages/reportes/ReportesEjecuciones';
import RolesPage from '../pages/admin/RolesPage';
import UsuariosPage from '../pages/admin/UsuariosPage';
import NeotelTestPage from '../pages/admin/NeotelTestPage';
import AuditoriaPage from '../pages/auditoria/AuditoriaPage';
import DashboardsPage from '../pages/dashboards/DashboardsPage';
import EmbeddedShell from '../components/layout/EmbeddedShell';
import TelefoniaCaso from '../pages/telefonia/TelefoniaCaso';
import TelefoniaHome from '../pages/telefonia/TelefoniaHome';

const AppRoutes = () => {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />

            {/*
              Rutas que abre la toolbar de Neotel. Van con un layout sin menú ni barra superior
              porque corren dentro de un iframe, donde ese espacio hace falta para gestionar.
              Ver docs/neotel-toolbar-spec.md.
            */}
            <Route path="/telefonia" element={<PrivateRoute><EmbeddedShell /></PrivateRoute>}>
                <Route index element={<TelefoniaHome />} />
                <Route path="home" element={<TelefoniaHome />} />
                <Route path="caso" element={<TelefoniaCaso />} />
            </Route>

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
                <Route path="reportes/nuevo" element={<ReportesBuilder />} />
                <Route path="reportes/:id/editar" element={<ReportesBuilder />} />
                <Route path="reportes/ejecuciones" element={<ReportesEjecuciones />} />
                <Route path="reportes/:id/ejecutar" element={<ReportesEjecutar />} />
                <Route path="admin/roles" element={<RolesPage />} />
                <Route path="admin/usuarios" element={<UsuariosPage />} />
                <Route path="admin/neotel-test" element={<NeotelTestPage />} />
                <Route path="auditoria" element={<AuditoriaPage />} />
                <Route path="dashboards" element={<DashboardsPage />} />
            </Route>
        </Routes>
    );
};

export default AppRoutes;
