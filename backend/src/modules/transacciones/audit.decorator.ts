// src/transacciones/audit.decorator.ts
import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { AuditInterceptor, AuditOptions } from './audit.interceptor';

export const Audit = (opts: AuditOptions) =>
    applyDecorators(UseInterceptors(new AuditInterceptor(null as any, opts)));