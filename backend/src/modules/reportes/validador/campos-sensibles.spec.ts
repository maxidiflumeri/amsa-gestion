import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validarDefinicion, recorrer, modeloPorNombre, ModeloDmmf } from './definicion-validator';
import { CAMPOS_PERMITIDOS_POR_MODELO, MODELOS_BLOQUEADOS, NOMBRE_SENSIBLE } from './campos-sensibles';
import { fechasSinClasificar } from './fechas-negocio';
import { DefinicionPlantillaDto } from '../dto/plantilla.dto';
import * as fs from 'fs';
import * as path from 'path';

const modelos = Prisma.dmmf.datamodel.models as unknown as ModeloDmmf[];

const col = (p: string) => ({ columnas: [{ id: 'c', path: p, label: 'X' }] }) as DefinicionPlantillaDto;
const mensaje = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).message;
  }
  throw new Error('no lanzó');
};

describe('campos sensibles', () => {
  it.each([
    'comentarios.usuario.agenteTelefonia.sipPasswordEnc',
    'comentarios.usuario.agenteTelefonia.claveNeotelEnc',
    'comentarios.usuario.dni',
    'comentarios.usuario.legajo',
    'comentarios.usuario.rolObj.permisos',
    'remesa.usuarioCreador.googleId',
    'remesa.archivoHash',
    'llamadas.sesion.device',
    'transacciones.usuario.googleId',
  ])('«%s» da 400 «no se puede usar en un reporte»', (p) => {
    expect(mensaje(() => validarDefinicion(col(p)))).toBe(`El campo «${p}» no se puede usar en un reporte`);
  });

  it('se aplica a filtros, ordenamientos, agrupaciones y totales', () => {
    const p = 'comentarios.usuario.dni';
    const base = { columnas: [{ id: 'c', path: 'documento', label: 'DNI' }] };
    expect(mensaje(() => validarDefinicion({ ...base, filtros: [{ id: 'f', path: p, operador: 'eq', valor: '1' }] } as any))).toContain('no se puede usar');
    expect(mensaje(() => validarDefinicion({ ...base, ordenamientos: [{ path: p, direccion: 'asc' }] } as any))).toContain('no se puede usar');
    expect(mensaje(() => validarDefinicion({ ...base, agrupaciones: [{ path: p }] } as any))).toContain('no se puede usar');
    expect(mensaje(() => validarDefinicion({ ...base, totales: [{ path: p, funcion: 'count' }] } as any))).toContain('no se puede usar');
  });

  it('lo que el catálogo muestra de usuario sigue disponible', () => {
    for (const p of ['comentarios.usuario.nombre', 'comentarios.usuario.email', 'remesa.usuarioCreador.nombre', 'pagos.usuario.id']) {
      expect(() => validarDefinicion(col(p))).not.toThrow();
    }
  });

  it('empresa.remesa.politicaId (que usa la plantilla de prod #1 y el catálogo oculta) sigue pasando', () => {
    expect(() => validarDefinicion(col('empresa.remesa.politicaId'))).not.toThrow();
  });

  /**
   * Recorre el modelo de Prisma entero desde el caso y desde la auditoría, hasta 5 niveles, y
   * verifica que NINGÚN camino alcanzable llegue a un campo sensible, atraviese un modelo
   * bloqueado o muestre de `usuario` algo fuera de la lista permitida.
   */
  it('ningún campo sensible queda alcanzable en todo el modelo', () => {
    let caminos = 0;
    const alcanzables: string[] = [];

    const recorrerModelo = (modelo: ModeloDmmf, prefijo: string[], profundidad: number) => {
      for (const campo of modelo.fields) {
        const nombres = [...prefijo, campo.name];
        const r = recorrer(modeloPorNombre(prefijo.length ? modeloDe(prefijo) : raizActual)!, nombres.slice(0));
        caminos++;
        if (r.existe) alcanzables.push(`${modelo.name}.${campo.name}`);
        if (campo.kind === 'object' && profundidad < 4) {
          const hijo = modeloPorNombre(campo.type);
          if (hijo && !MODELOS_BLOQUEADOS.has(hijo.name)) recorrerModelo(hijo, nombres, profundidad + 1);
        }
      }
    };

    let raizActual = '';
    const modeloDe = (prefijo: string[]): string => {
      let actual = modeloPorNombre(raizActual)!;
      for (const n of prefijo) actual = modeloPorNombre(actual.fields.find((f) => f.name === n)!.type)!;
      return actual.name;
    };

    for (const raiz of ['deudor', 'transaccion']) {
      raizActual = raiz;
      recorrerModelo(modeloPorNombre(raiz)!, [], 0);
    }

    expect(caminos).toBeGreaterThan(1000);
    for (const alcanzable of alcanzables) {
      const [modelo, campo] = alcanzable.split('.');
      expect(MODELOS_BLOQUEADOS.has(modelo)).toBe(false);
      expect(NOMBRE_SENSIBLE.test(campo)).toBe(false);
      const permitidos = CAMPOS_PERMITIDOS_POR_MODELO[modelo];
      if (permitidos) expect(permitidos).toContain(campo);
    }
  });

  it('los modelos y campos de credenciales que hay hoy en el schema están todos cubiertos', () => {
    const conSecretos = modelos.filter((m) => m.fields.some((f) => NOMBRE_SENSIBLE.test(f.name) && f.kind === 'scalar' && !/^tokens/.test(f.name)));
    for (const m of conSecretos) {
      const cubierto = MODELOS_BLOQUEADOS.has(m.name) || CAMPOS_PERMITIDOS_POR_MODELO[m.name] !== undefined;
      // `remesa.archivoHash` se cubre por el nombre del campo.
      const porNombre = m.fields.filter((f) => NOMBRE_SENSIBLE.test(f.name)).every((f) => !recorrer(m, [f.name]).existe);
      expect(cubierto || porNombre).toBe(true);
    }
  });
});

describe('clasificación de fechas', () => {
  it('toda columna DateTime del schema está clasificada como calendario o instante (agregá la nueva en fechas-negocio.ts)', () => {
    expect(fechasSinClasificar()).toEqual([]);
  });
});

describe('el fixture de prod #1 con la lista de bloqueo', () => {
  it('sigue pasando', () => {
    const plantilla = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'plantilla-prod-1.json'), 'utf8'));
    expect(() => validarDefinicion(plantilla.definicion, plantilla.raiz)).not.toThrow();
  });
});
