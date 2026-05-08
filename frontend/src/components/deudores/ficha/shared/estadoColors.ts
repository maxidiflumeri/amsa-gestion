export const estadoConvenioColor = (estado: string): 'success' | 'warning' | 'default' | 'error' => {
    if (estado === 'ACTIVO') return 'success';
    if (estado === 'INCUMPLIDO') return 'warning';
    if (estado === 'ANULADO') return 'error';
    return 'default';
};

export const estadoCuotaColor = (estado: string): 'success' | 'warning' | 'default' | 'error' => {
    if (estado === 'PAGADA') return 'success';
    if (estado === 'VENCIDA') return 'error';
    if (estado === 'PENDIENTE') return 'warning';
    return 'default';
};
