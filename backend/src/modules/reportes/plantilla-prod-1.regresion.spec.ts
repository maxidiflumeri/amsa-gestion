import { readFileSync } from 'fs';
import { join } from 'path';
import { QueryPlanner } from './planner/query-planner';
import { validarDefinicion } from './validador/definicion-validator';
import { DefinicionPlantillaDto } from './dto/plantilla.dto';

/**
 * La única plantilla que hay en prod (id 1, "base predictiva"). Ninguna validación nueva puede
 * hacerla fallar ni cambiarle el resultado.
 *
 * `plan-prod-1.esperado.json` se sacó corriendo el planner **de antes** del cambio con estos mismos
 * valores: si el `where`, el `include` o el post-procesado cambian, el test avisa.
 */
const fixtureDir = join(__dirname, '__fixtures__');
const plantilla = JSON.parse(readFileSync(join(fixtureDir, 'plantilla-prod-1.json'), 'utf8'));
const esperado = JSON.parse(readFileSync(join(fixtureDir, 'plan-prod-1.esperado.json'), 'utf8'));
const definicion = plantilla.definicion as DefinicionPlantillaDto;

const ID = {
  empresa: '60884e76-a79d-42af-80b1-f884e94ba1e3',
  remesaIncluye: 'e516b35e-a01d-4388-9038-16af92a6754f',
  remesaOmite: 'e72b381d-21b9-458e-8408-e9bb824ed564',
  gestion: '80fef08e-10d9-4091-bb46-4a802bc1058f',
  situacion: 'd35bc68d-d0eb-42dd-8453-2917a33cf620',
};

// Lo que ve el backend al ejecutar: va por JSON, igual que el body de la request.
const viaJson = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('plantilla de prod #1', () => {
  const planner = new QueryPlanner();

  it('pasa las validaciones nuevas (al guardar)', () => {
    expect(() => validarDefinicion(definicion, plantilla.raiz)).not.toThrow();
  });

  it('armaba el mismo plan antes del cambio, con todos los filtros variables completos', () => {
    const vars = {
      [ID.empresa]: 'AYSA',
      [ID.remesaIncluye]: ['10', '20'],
      [ID.remesaOmite]: ['15', '16'],
      [ID.gestion]: ['Nuevo', 'En gestión'],
      [ID.situacion]: ['Sin gestión'],
    };
    expect(viaJson(planner.planQuery(definicion, vars))).toEqual(esperado.completo);
  });

  it('con solo los obligatorios', () => {
    const vars = { [ID.empresa]: 'AYSA', [ID.remesaIncluye]: ['10', '20'] };
    expect(viaJson(planner.planQuery(definicion, vars))).toEqual(esperado.minimo);
  });

  it('en preview sin valores', () => {
    expect(viaJson(planner.planQuery(definicion, {}, true))).toEqual(esperado.preview);
  });

  it('sigue exigiendo los obligatorios al ejecutar', () => {
    expect(() => planner.planQuery(definicion, {})).toThrow(/es requerido/);
  });
});
