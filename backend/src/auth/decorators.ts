import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISOS_KEY = 'permisos';
export const Permisos = (...permisos: string[]) => SetMetadata(PERMISOS_KEY, permisos);

export const UsuarioActual = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        return request['usuario'];
    },
);
