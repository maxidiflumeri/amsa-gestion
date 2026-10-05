import { RealtimeService } from './realtime.service';
import type { EstadoCargaDto } from '../imports/progreso/estado-carga.types';

const estado = (o: Partial<EstadoCargaDto> = {}): EstadoCargaDto => ({ remesaId: 7, usuarioId: 3, ...o } as EstadoCargaDto);

function armar() {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const service = new RealtimeService({ server: { to } } as any);
    return { service, to, emit };
}

describe('RealtimeService — eventos de importación', () => {
    const casos: Array<['emitImportIniciada' | 'emitImportProgreso' | 'emitImportFinalizada', string]> = [
        ['emitImportIniciada', 'import:iniciada'],
        ['emitImportProgreso', 'import:progreso'],
        ['emitImportFinalizada', 'import:finalizada'],
    ];

    it.each(casos)('%s hace UNA llamada a server.to con las dos salas y un solo emit', (metodo, evento) => {
        const { service, to, emit } = armar();
        const e = estado();
        service[metodo](e);
        expect(to).toHaveBeenCalledTimes(1);
        expect(to).toHaveBeenCalledWith(['user:3', 'admin:importaciones']);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(evento, e);
    });

    it.each(casos)('%s sin usuarioId emite solo a admin:importaciones', (metodo, evento) => {
        const { service, to, emit } = armar();
        const e = estado({ usuarioId: null });
        service[metodo](e);
        expect(to).toHaveBeenCalledTimes(1);
        expect(to).toHaveBeenCalledWith(['admin:importaciones']);
        expect(emit).toHaveBeenCalledWith(evento, e);
    });

    it.each(casos)('%s no propaga si server.to tira', (metodo) => {
        const to = jest.fn().mockImplementation(() => { throw new Error('socket caído'); });
        const service = new RealtimeService({ server: { to } } as any);
        expect(() => service[metodo](estado())).not.toThrow();
    });

    it.each(casos)('%s no propaga si emit tira', (metodo) => {
        const to = jest.fn().mockReturnValue({ emit: () => { throw new Error('boom'); } });
        const service = new RealtimeService({ server: { to } } as any);
        expect(() => service[metodo](estado())).not.toThrow();
    });
});
