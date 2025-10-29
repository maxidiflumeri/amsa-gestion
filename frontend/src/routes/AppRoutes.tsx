import { Route, Routes } from 'react-router-dom'
import PrivateRoute from './PrivateRoute'
import PrivateLayout from '../components/layout/PrivateLayout'
import DeudoresPage from '../pages/DeudoresPage'
import Login from '../pages/Login'
import Inicio from '../pages/Inicio'

const AppRoutes = () => {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />

            <Route path="/" element={<PrivateRoute><PrivateLayout /></PrivateRoute>}>
                <Route index element={<Inicio />} />
                <Route path="gestion" element={<DeudoresPage />} />
                {/* futuras rutas privadas */}
            </Route>
        </Routes>
    )
}

export default AppRoutes