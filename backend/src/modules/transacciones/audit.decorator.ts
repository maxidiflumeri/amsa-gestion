import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuditInterceptor, AuditOptions } from './audit.interceptor';

/**
 * Decorador dinámico que crea un interceptor con las opciones indicadas.
 * Nest inyecta ModuleRef para resolver TransaccionesService.
 */
export function Audit(opts: AuditOptions) {
    class DynamicAuditInterceptor extends AuditInterceptor {
        constructor(moduleRef: ModuleRef) {
            super(moduleRef);
            super.setOptions(opts);
        }
    }

    return applyDecorators(UseInterceptors(DynamicAuditInterceptor));
}