import { useNotificaciones } from '../context/NotificacionesContext';

export function useImportacionesEnCurso() {
    const { importsEnCurso } = useNotificaciones();
    return importsEnCurso;
}
