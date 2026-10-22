import api from './axios';

/** Lo que devuelve `GET /auth/perfil`: los datos propios, con legajo, DNI y fecha de alta. */
export interface PerfilDto {
    id: number;
    nombre: string;
    email: string;
    avatarUrl: string | null;
    rol: string;
    permisos: string[];
    legajo: string | null;
    dni: string | null;
    fechaAlta: string;
}

export async function getPerfil(): Promise<PerfilDto> {
    const { data } = await api.get<PerfilDto>('/auth/perfil');
    return data;
}
