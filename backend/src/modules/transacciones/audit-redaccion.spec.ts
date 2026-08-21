import { redactarCamposSensibles } from './audit.enums';

/**
 * El alta y la edición de usuario auditan `req.body` entero, así que lo que no esté en la lista de
 * campos sensibles queda **legible en `transaccion.data`** para cualquiera con `auditoria.ver_todos`.
 */
describe('redactarCamposSensibles', () => {
    it('tapa las credenciales del agente de telefonía', () => {
        const out = redactarCamposSensibles({
            nombre: 'Ana Pérez',
            agente: { usuarioNeotel: 'ana', claveNeotel: 'SECRETA', sipAuthUser: 'ana', sipPassword: 'OTRA' },
        });
        expect(out.agente.claveNeotel).toBe('[REDACTED]');
        expect(out.agente.sipPassword).toBe('[REDACTED]');
    });

    it('deja visible lo que no es secreto', () => {
        const out = redactarCamposSensibles({
            nombre: 'Ana Pérez',
            agente: { usuarioNeotel: 'ana', sipAuthUser: 'ana' },
        });
        expect(out.nombre).toBe('Ana Pérez');
        expect(out.agente.usuarioNeotel).toBe('ana');
        expect(out.agente.sipAuthUser).toBe('ana');
    });

    it('NO tapa parametro.clave, que es un código de negocio y no un secreto', () => {
        const out = redactarCamposSensibles({ clave: 'SIT-050', descripcion: 'Cancelado / Pagado' });
        expect(out.clave).toBe('SIT-050');
    });

    it('recorre arrays y anidados', () => {
        const out = redactarCamposSensibles({ agentes: [{ claveNeotel: 'A' }, { claveNeotel: 'B' }] });
        expect(out.agentes.map((a: any) => a.claveNeotel)).toEqual(['[REDACTED]', '[REDACTED]']);
    });

    it('no rompe con null ni con primitivos', () => {
        expect(redactarCamposSensibles(null as any)).toBeNull();
        expect(redactarCamposSensibles('texto' as any)).toBe('texto');
    });
});
