import { useState, useEffect } from 'react';
import api from '../api/axios';

export interface Empresa {
    id: number;
    nombre: string;
    cuit?: string;
}

export function useEmpresas() {
    const [empresas, setEmpresas] = useState<Empresa[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchEmpresas = async () => {
            try {
                setLoading(true);
                const res = await api.get('/import/empresas');
                setEmpresas(res.data);
                setError(null);
            } catch (err: any) {
                console.error("Error fetching empresas:", err);
                setError(err.response?.data?.message || err.message || "Error al cargar empresas");
            } finally {
                setLoading(false);
            }
        };

        fetchEmpresas();
    }, []);

    return { empresas, loading, error };
}
