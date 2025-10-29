// src/routes/PrivateRoute.tsx
import React from 'react'
import { Navigate } from 'react-router-dom'

// 🔒 esto se puede reemplazar con contexto real o JWT
const isAuthenticated = true

const PrivateRoute = ({ children }: { children: JSX.Element }) => {
    return isAuthenticated ? children : <Navigate to="/login" />
}

export default PrivateRoute