import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { MapaReconocibles, PerfilEjemplo, perfilarArchivo } from './perfil-ejemplo';
import { perfilATexto } from './perfil-a-texto';

/**
 * Privacidad (docs/asistente-reportes-spec.md §8 y §20.1): por CADA archivo de `__fixtures__/reportes/`, ninguno de sus
 * valores sensibles aparece en el perfil que se guarda ni en el texto que lee el modelo. Si alguien agrega un fixture,
 * `generar-fixtures.ts` tiene que agregar su lista en `valores-sensibles.json`: este test falla si falta.
 */
const dir = path.join(__dirname, '..', '__fixtures__', 'reportes');
const sensibles: Record<string, string[]> = JSON.parse(fs.readFileSync(path.join(dir, 'valores-sensibles.json'), 'utf8'));
const archivos = fs.readdirSync(dir).filter((f) => f !== 'valores-sensibles.json');

describe('privacidad del perfil', () => {
    it('hay una lista de valores sensibles por cada fixture', () => {
        expect(archivos.sort()).toEqual(Object.keys(sensibles).sort());
    });

    // Con y sin valores reconocidos: lo reconocido es el valor del vocabulario, nunca el de la celda.
    const RECONOCIBLES: MapaReconocibles = {
        toyota: { valor: 'TOYOTA', campo: 'empresa.nombre' },
        telecom: { valor: 'TELECOM', campo: 'empresa.nombre' },
        vigente: { valor: 'VIGENTE', campo: 'promesas.estado' },
        incumplida: { valor: 'INCUMPLIDA', campo: 'promesas.estado' },
        'en gestion': { valor: 'EN GESTION', campo: 'estadoSituacion.descripcion' },
        promesa: { valor: 'PROMESA', campo: 'estadoSituacion.descripcion' },
    };
    const con = [false, true];
    it.each(archivos.flatMap((a) => con.map((r) => [a, r] as const)))('%s (reconocibles=%s): ningún valor sensible en el perfil ni en el texto del modelo', (archivo, conReconocibles) => {
        const perfil = perfilarArchivo(fs.readFileSync(path.join(dir, archivo)), archivo, conReconocibles ? RECONOCIBLES : {});
        const salidas = {
            perfil: JSON.stringify(perfil),
            texto: perfilATexto(perfil, 1),
            textoCadaHoja: perfil.hojas.map((_, i) => perfilATexto(perfil, 1, { hoja: i })).join('\n'),
        };
        for (const valor of sensibles[archivo]) {
            for (const [donde, contenido] of Object.entries(salidas)) {
                if (contenido.includes(valor)) throw new Error(`«${valor}» apareció en ${donde} de ${archivo}`);
            }
        }
    });

    describe('ataques: los datos nunca se toman como encabezado', () => {
        const SENSIBLES = ['30111222', 'GOMEZ', 'MARIA', '1144556677', 'mgomez', 'gmail', '27888999', 'Lopez', 'Diaz', '1500'];
        const verTodo = (p: PerfilEjemplo) => `${JSON.stringify(p)}\n${perfilATexto(p, 1)}`;
        const sinSensibles = (txt: string) => {
            for (const v of SENSIBLES) expect(txt).not.toContain(v);
        };

        it('un CSV de UNA fila con datos: sin encabezado y ningún valor', () => {
            const p = perfilarArchivo(Buffer.from('30111222;GOMEZ MARIA;1144556677;mgomez@gmail.com\n'), 'a.csv');
            expect(p.hojas[0].conEncabezado).toBe(false);
            sinSensibles(verTodo(p));
        });

        it('un XLSX de 1 fila con el DNI como texto', () => {
            const ws = XLSX.utils.aoa_to_sheet([['30111222', 'GOMEZ MARIA', '1144556677']]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'H');
            const p = perfilarArchivo(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'a.xlsx');
            expect(p.hojas[0].conEncabezado).toBe(false);
            sinSensibles(verTodo(p));
        });

        it('4 textos y un importe con 3 filas (la regla del 80 %)', () => {
            const p = perfilarArchivo(Buffer.from('Juan;GOMEZ;Lopez;Diaz;1500,50\nAna;PEREZ;Ruiz;Paz;20,00\nLuis;SOSA;Mora;Vega;30,75\n'), 'a.csv');
            expect(p.hojas[0].conEncabezado).toBe(false);
            sinSensibles(verTodo(p));
        });

        it('una fila con una celda que no parece encabezado no lo es (mail, número largo, teléfono con forma, texto largo)', () => {
            for (const celda of ['mgomez@gmail.com', '30111222', '11 5555-7788', 'x'.repeat(70), '27-30111222-4']) {
                const p = perfilarArchivo(Buffer.from(`Nombre;Saldo;${celda}\nAna;10,50;a\nLuis;20,00;b\n`), 'a.csv');
                expect(p.hojas[0].conEncabezado).toBe(false);
            }
        });

        it('los encabezados de verdad siguen siendo encabezados', () => {
            const p = perfilarArchivo(Buffer.from('DNI;Nombre;Tel 1;Saldo\n30111222;Ana;1144556677;10,50\n27888999;Luis;1133334444;20,00\n'), 'a.csv');
            expect(p.hojas[0].conEncabezado).toBe(true);
            expect(p.hojas[0].columnas.map((c) => c.encabezado)).toEqual(['DNI', 'Nombre', 'Tel 1', 'Saldo']);
        });

        it('segunda red: un perfil ya guardado con datos como «encabezado» sale enmascarado en el texto del modelo', () => {
            const base = perfilarArchivo(Buffer.from('DNI;Nombre\n30111222;Ana\n'), 'a.csv');
            const viejo: PerfilEjemplo = JSON.parse(JSON.stringify(base));
            viejo.hojas[0].columnas[0].encabezado = '30111222';
            viejo.hojas[0].columnas[1].encabezado = 'mgomez@gmail.com';
            viejo.hojas[0].nombre = '1144556677';
            const t = perfilATexto(viejo, 3);
            expect(t).not.toMatch(/30111222|mgomez|gmail|1144556677/);
            expect(t).toContain('«99999999»');
            expect(t).toContain('«xxxxxx@xxxxx.xxx»');
        });

        it('un archivo que ya trae el encabezado en una hoja con nombre de dato: el nombre de la hoja también sale enmascarado', () => {
            const ws = XLSX.utils.aoa_to_sheet([['DNI'], ['1']]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '30111222');
            const p = perfilarArchivo(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, 'a.xlsx');
            expect(verTodo(p)).not.toContain('30111222');
        });
    });

    it('un archivo sin encabezado no deja la primera fila (datos) en el perfil', () => {
        const buf = Buffer.from('Juan Carlos;4455\nAna Maria;9988\nLuis Diaz;1234\n');
        const perfil = perfilarArchivo(buf, 'x.csv');
        expect(JSON.stringify(perfil)).not.toMatch(/Juan|Carlos|Ana|Maria|Luis|Diaz/);
    });

    it('lo reconocido es el valor del vocabulario, no el de la celda', () => {
        const buf = Buffer.from('Empresa;N\n toyota ;1\nToyota;2\n');
        const perfil = perfilarArchivo(buf, 'x.csv', { toyota: { valor: 'TOYOTA', campo: 'empresa.nombre' } });
        const rec = perfil.hojas[0].columnas[0].reconocidos;
        expect(rec).toEqual([{ valor: 'TOYOTA', campo: 'empresa.nombre' }]);
    });
});

describe('re-auditoría del 19/10: el código de formato de Excel no lleva texto literal', () => {
    it('saca lo entre comillas y lo escapado', () => {
        const { formatoExcelSinLiterales } = require('./perfil-ejemplo');
        expect(formatoExcelSinLiterales('"GOMEZ 30111222 "0')).toBe('""0');
        expect(formatoExcelSinLiterales('\\G\\O\\M #,##0.00')).toBe(' #,##0.00');
        expect(formatoExcelSinLiterales('dd/mm/yyyy')).toBe('dd/mm/yyyy');
        expect(formatoExcelSinLiterales('#,##0.00')).toBe('#,##0.00');
    });
});
