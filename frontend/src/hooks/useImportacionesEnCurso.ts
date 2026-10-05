import { useNotificaciones } from '../context/NotificacionesContext';
import type { EstadoCargaDto } from '../types/importProgreso';

export function useImportacionesEnCurso(): EstadoCargaDto[] {
    const { importsEnCurso } = useNotificaciones();
    return importsEnCurso;
}
