import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import {
    TurnoHistorial,
    armarContexto,
    armarSystem,
    armarTools,
    conBreakpointRodante,
    formatearFechaAr,
    paramsDeLlamada,
    recortarHistorial,
    slugsPresentes,
} from './armar-request';

const turno = (pregunta: string, respuesta: string, extra: Partial<MessageParam>[] = []): TurnoHistorial => ({
    mensajes: [
        { role: 'user', content: [{ type: 'text', text: pregunta }] },
        { role: 'system', content: 'Contexto de este turno' },
        ...(extra as MessageParam[]),
        { role: 'assistant', content: [{ type: 'text', text: respuesta }] },
    ],
});

describe('armar-request', () => {
    describe('armarSystem', () => {
        it('es determinista: mismas entradas, mismos bytes; sin fechas, nombres ni ids', () => {
            const a = armarSystem('INSTR', 'MAPA', 'INDICE');
            const b = armarSystem('INSTR', 'MAPA', 'INDICE');
            expect(JSON.stringify(a)).toBe(JSON.stringify(b));
            expect(a).toHaveLength(1);
            expect(a[0].text).toBe('INSTR\n\n# Mapa de pantallas\n\nMAPA\n\n# Índice de la wiki\n\nINDICE');
            expect(a[0].cache_control).toEqual({ type: 'ephemeral' });
        });
    });

    describe('armarTools', () => {
        it('orden fijo y enums tal como llegan; strict solo si se pide', () => {
            const sin = armarTools(['a/b', 'c/d'], ['/', '/gestion'], false);
            expect(sin.map((t) => t.name)).toEqual(['leer_pagina', 'buscar_en_wiki', 'ofrecer_ir_a']);
            expect(sin.some((t) => 'strict' in t)).toBe(false);
            expect((sin[0].input_schema as any).properties.slug.enum).toEqual(['a/b', 'c/d']);
            expect(sin[1].input_schema).toMatchObject({ required: ['texto'], additionalProperties: false });
            expect((sin[2].input_schema as any).properties.ruta.enum).toEqual(['/', '/gestion']);

            const con = armarTools(['a/b'], ['/'], true);
            expect(con.every((t) => (t as { strict?: boolean }).strict === true)).toBe(true);
        });
    });

    describe('paramsDeLlamada y breakpoints', () => {
        const system = armarSystem('I', 'M', 'X');
        const tools = armarTools(['a/b'], ['/'], true);

        it('effort low, 2048 tokens, sin thinking explícito ni temperature', () => {
            const p = paramsDeLlamada({
                modelo: 'us.anthropic.claude-haiku-5-5',
                system,
                tools,
                messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
            }) as unknown as Record<string, unknown>;
            expect(p.max_tokens).toBe(2048);
            expect(p.output_config).toEqual({ effort: 'low' });
            expect(p).not.toHaveProperty('thinking');
            expect(p).not.toHaveProperty('temperature');
            expect(p).not.toHaveProperty('top_p');
        });

        it('solo hay breakpoints en el system y en el último bloque del último mensaje user', () => {
            const messages: MessageParam[] = [
                { role: 'user', content: [{ type: 'text', text: 'q1' }] },
                { role: 'system', content: 'ctx1' },
                { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'leer_pagina', input: { slug: 'a/b' } }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'texto' }] },
            ];
            const p = paramsDeLlamada({ modelo: 'm', system, tools, messages });
            const json = JSON.stringify(p);
            expect((json.match(/cache_control/g) ?? []).length).toBe(2);
            expect((p.messages[3].content as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
            expect((p.messages[0].content as any[])[0].cache_control).toBeUndefined();
        });

        it('no ensucia los mensajes originales (los guardados nunca llevan cache_control)', () => {
            const messages: MessageParam[] = [{ role: 'user', content: [{ type: 'text', text: 'q1' }] }];
            conBreakpointRodante(messages);
            expect(JSON.stringify(messages)).not.toContain('cache_control');
        });

        it('el último user cuenta aunque haya un mensaje system después (la pregunta)', () => {
            const out = conBreakpointRodante([
                { role: 'user', content: 'pregunta' },
                { role: 'system', content: 'ctx' },
            ]);
            expect(out[0].content).toEqual([{ type: 'text', text: 'pregunta', cache_control: { type: 'ephemeral' } }]);
            expect(out[1].content).toBe('ctx');
        });
    });

    describe('slugsPresentes', () => {
        it('encuentra la página del contexto y las leídas con leer_pagina', () => {
            const mensajes: MessageParam[] = [
                { role: 'user', content: 'q' },
                { role: 'system', content: 'Contexto\n<pagina slug="gestion/buscar-un-caso">\ncuerpo\n</pagina>' },
                { role: 'assistant', content: [{ type: 'tool_use', id: '1', name: 'leer_pagina', input: { slug: 'reportes/filtros' } }] },
                { role: 'assistant', content: [{ type: 'tool_use', id: '2', name: 'ofrecer_ir_a', input: { ruta: '/gestion', motivo: 'x' } }] },
            ];
            expect([...slugsPresentes(mensajes)].sort()).toEqual(['gestion/buscar-un-caso', 'reportes/filtros']);
        });

        it('"ya está más arriba" no cuenta como una página incluida', () => {
            const s = slugsPresentes([{ role: 'system', content: 'La página de ayuda de esta pantalla ([a/b]) ya está más arriba' }]);
            expect(s.size).toBe(0);
        });
    });

    describe('armarContexto', () => {
        const base = {
            nombre: 'Ana',
            rol: 'OPERADOR',
            ahora: new Date('2026-10-16T17:05:00Z'),
            ruta: '/gestion',
            nombrePantalla: 'Gestión',
            etiquetasPermisos: ['Ver deudores', 'Ver reportes'],
            rutasAbribles: ['/', '/gestion'],
        };

        it('incluye la página de la pantalla la primera vez', () => {
            const c = armarContexto({ ...base, pagina: { slug: 'gestion/buscar-un-caso', titulo: 'Buscar', cuerpo: 'CUERPO' }, paginaYaPresente: false });
            expect(c).toContain('- Persona: Ana · rol OPERADOR');
            expect(c).toContain('- Fecha y hora: viernes 16/10/2026 14:05 (Argentina)');
            expect(c).toContain('- Pantalla actual: /gestion — Gestión');
            expect(c).toContain('- Permisos de su rol: Ver deudores; Ver reportes');
            expect(c).toContain('- Pantallas que puede abrir: /, /gestion');
            expect(c).toContain('<pagina slug="gestion/buscar-un-caso">\nCUERPO\n</pagina>');
        });

        it('no repite la página si ya está en la conversación', () => {
            const c = armarContexto({ ...base, pagina: { slug: 'gestion/buscar-un-caso', titulo: 'Buscar', cuerpo: 'CUERPO' }, paginaYaPresente: true });
            expect(c).not.toContain('CUERPO');
            expect(c).toContain('([gestion/buscar-un-caso]) ya está más arriba en la conversación.');
        });

        it('pantalla sin página y pantalla sin nombre en el mapa', () => {
            const c = armarContexto({ ...base, nombrePantalla: null, pagina: null, paginaYaPresente: false });
            expect(c).toContain('pantalla sin nombre en el mapa');
            expect(c).toContain('Esta pantalla no tiene página de ayuda principal.');
        });

        it('las coincidencias de la búsqueda automática van antes de la página, con su sección y fragmento', () => {
            const c = armarContexto({
                ...base,
                pagina: { slug: 'gestion/buscar-un-caso', titulo: 'Buscar', cuerpo: 'CUERPO' },
                paginaYaPresente: false,
                coincidencias: [
                    { slug: 'importacion/crear-plantilla', titulo: 'Crear una plantilla', camino: ['Paso 5', 'Bloques repetitivos'], fragmento: '…se declaran como bloques…', puntaje: 9, cobertura: 1 },
                ],
            });
            expect(c).toContain('Secciones de la wiki donde aparecen las palabras de la pregunta');
            expect(c).toContain('- [importacion/crear-plantilla] Crear una plantilla › Paso 5 › Bloques repetitivos: «…se declaran como bloques…»');
            expect(c.indexOf('Bloques repetitivos')).toBeLessThan(c.indexOf('<pagina slug'));
        });

        it('sin coincidencias no hay bloque de búsqueda', () => {
            const c = armarContexto({ ...base, pagina: null, paginaYaPresente: false, coincidencias: [] });
            expect(c).not.toContain('Secciones de la wiki donde aparecen');
        });

        it('en Documentación dice qué página tiene abierta la persona, la primera vez con su texto', () => {
            const pagina = { slug: 'importacion/crear-plantilla', titulo: 'Crear una plantilla', cuerpo: 'CUERPO' };
            const datos = { ...base, ruta: '/ayuda', nombrePantalla: 'Documentación', pagina, paginaAbiertaEnDocumentacion: true };
            const primera = armarContexto({ ...datos, paginaYaPresente: false });
            expect(primera).toContain('Página que la persona tiene abierta en Documentación: [importacion/crear-plantilla] Crear una plantilla');
            expect(primera).toContain('<pagina slug="importacion/crear-plantilla">\nCUERPO\n</pagina>');
            expect(primera).not.toContain('no tiene página de ayuda principal');
            const despues = armarContexto({ ...datos, paginaYaPresente: true });
            expect(despues).toContain('tiene abierta en Documentación la página [importacion/crear-plantilla], que ya está más arriba');
            expect(despues).not.toContain('CUERPO');
        });

        it('la fecha va en hora de Argentina (a las 02:59Z del 1.º todavía es 31)', () => {
            expect(formatearFechaAr(new Date('2026-11-01T02:59:00Z'))).toBe('sábado 31/10/2026 23:59');
        });
    });

    describe('recortarHistorial', () => {
        const grande = (n: number) => turno('p'.repeat(n), 'r'.repeat(n));

        it('sin pasarse del máximo no recorta nada', () => {
            const h = [grande(300), grande(300)];
            const r = recortarHistorial(h, { ultimoPromptTokens: 1000, charsNuevo: 100, maxTokens: 60000 });
            expect(r.historial).toHaveLength(2);
            expect(r.descartados).toBe(0);
        });

        it('si se pasa, saca turnos ENTEROS desde el más viejo', () => {
            const h = [grande(30000), grande(30000), grande(30000)];
            // Cada turno ≈ 20.000 tokens. Último prompt 65.000 → hay que sacar al menos 1 para bajar de 60.000.
            const r = recortarHistorial(h, { ultimoPromptTokens: 65000, charsNuevo: 300, maxTokens: 60000 });
            expect(r.descartados).toBeGreaterThanOrEqual(1);
            expect(r.historial).toEqual(h.slice(r.descartados));
            for (const t of r.historial) expect(t.mensajes[0].role).toBe('user');
        });

        it('nunca saca más turnos de los que hay', () => {
            const r = recortarHistorial([grande(10)], { ultimoPromptTokens: 999999, charsNuevo: 0, maxTokens: 60000 });
            expect(r.historial).toEqual([]);
            expect(r.descartados).toBe(1);
        });
    });
});
