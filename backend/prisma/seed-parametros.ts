import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();
// Path relativo desde backend/prisma → ../../varios (portable Linux/Windows/Mac)
const EXCELS_DIR = path.resolve(__dirname, '../../varios');

interface CodigoRaw {
  empresa: string;
  param: string;
  param_3: string | number;
  descripcion: string;
  auxiliar?: string;
}

interface ParametroData {
  grupo: string;
  clave: string;
  descripcion: string;
  categoria: string | null;
  esGlobal: boolean;
  empresaLegacy: string;
  descripcionOriginal: string;
}

interface EmpresaLegacy {
  id: string;
  nombre: string;
  dbId?: number;
}

// Normalización de tipo de parámetro
function normalizarGrupo(param: string): { grupo: string; prefijo: string } {
  switch (param) {
    case '010':
      return { grupo: 'gestion', prefijo: 'GES-' };
    case '000':
      return { grupo: 'situacion', prefijo: 'SIT-' };
    case '211':
      return { grupo: 'motivo_no_pago', prefijo: 'MNP-' };
    default:
      throw new Error(`Tipo de parámetro desconocido: ${param}`);
  }
}

// Categorización de gestión
function categorizarGestion(descripcion: string): string {
  const desc = descripcion.toUpperCase();

  if (desc.includes('PAGO') || desc.includes('MERCADO') || desc.includes('CUPON')) {
    return 'PAGO';
  }
  if (desc.includes('PROMESA') || desc.includes('PP ')) {
    return 'PROMESA';
  }
  if (desc.includes('CONVENIO') || desc.includes('CONV.') || desc.includes('ACUERDO') || desc.includes('PLAN DE PAGO')) {
    return 'CONVENIO';
  }
  if (desc.includes('RECLAMO') || desc.includes('FRAUDE') || desc.includes('DESCONOCE')) {
    return 'RECLAMO';
  }
  if (desc.includes('NO CONTESTA') || desc.includes('INUBICABLE') || desc.includes('INTENTOS') || desc.includes('BUSQUEDA')) {
    return 'SIN_CONTACTO';
  }
  if (desc.includes('TELEFONO') || desc.includes('DOMICILIO') || desc.includes('DATO') || desc.includes('ERRONEO')) {
    return 'DATO_INCORRECTO';
  }
  if (desc.includes('DERIVA') || desc.includes('LIBERAR')) {
    return 'DERIVACION';
  }
  if (desc.includes('NO AFRONTA') || desc.includes('NEGATIVA') || desc.includes('QUITA')) {
    return 'NEGATIVA';
  }
  if (desc.includes('DADO DE BAJA') || desc.includes('CANCELADO') || desc.includes('REMESA')) {
    return 'ADMIN';
  }

  return 'CONTACTO';
}

// Categorización de situación
function categorizarSituacion(descripcion: string): string {
  const desc = descripcion.toUpperCase();

  if (desc.includes('PAGANDO') || desc.includes('PAGO')) {
    return 'PAGANDO';
  }
  if (desc.includes('PROMESA')) {
    return 'PROMESA';
  }
  if (desc.includes('CONVENIO') || desc.includes('CONV.')) {
    return 'CONVENIO';
  }
  if (desc.includes('NEGATIVA')) {
    return 'NEGATIVA';
  }
  if (desc.includes('FALLECIDO') || desc.includes('RESCISION') || desc.includes('RESCISIÓN') || desc.includes('ANULADO')) {
    return 'BAJA';
  }
  if (desc.includes('NO CONTACTADO') || desc.includes('SIN CONTACTO')) {
    return 'SIN_CONTACTO';
  }
  if (desc.includes('CONTACTADO')) {
    return 'CONTACTADO';
  }
  if (desc.includes('CANCELADO') || desc.includes('CANC.')) {
    return 'CANCELADO';
  }

  return 'CONTACTADO';
}

// Categorización de motivo de no pago
function categorizarMotivoNoPago(descripcion: string): string {
  const desc = descripcion.toUpperCase();

  if (desc.includes('ECONOMIC') || desc.includes('FINANCIERO') || desc.includes('DESEMPLEO')) {
    return 'ECONOMICO';
  }
  if (desc.includes('DESCONOCE') || desc.includes('NO RECONOCE') || desc.includes('NO SOLICITO') ||
      desc.includes('NO RECIBIO') || desc.includes('NO RECIBE')) {
    return 'DESCONOCE';
  }
  if (desc.includes('RECLAMO') || desc.includes('DENUNCIA') || desc.includes('DISPUTA')) {
    return 'DISPUTA';
  }
  if (desc.includes('FACTURA')) {
    return 'FACTURACION';
  }
  if (desc.includes('MEDIO DE PAGO') || desc.includes('CUENTA')) {
    return 'MEDIO_PAGO';
  }
  if (desc.includes('ACUERDO') || desc.includes('PLAN') || desc.includes('REFINANC') || desc.includes('CAUTELAR')) {
    return 'ACUERDO';
  }
  if (desc.includes('FALLECIDO') || desc.includes('BAJA') || desc.includes('RENUNCIA') || desc.includes('RESCISION')) {
    return 'BAJA';
  }

  return 'ECONOMICO';
}

// Función de categorización según el grupo
function categorizar(grupo: string, descripcion: string): string | null {
  if (grupo === 'gestion') {
    return categorizarGestion(descripcion);
  }
  if (grupo === 'situacion') {
    return categorizarSituacion(descripcion);
  }
  if (grupo === 'motivo_no_pago') {
    return categorizarMotivoNoPago(descripcion);
  }
  return null;
}

// Leer archivo Excel y procesar códigos
function leerCodigosExcel(archivo: string): ParametroData[] {
  const filePath = path.join(EXCELS_DIR, archivo);
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data: any[] = XLSX.utils.sheet_to_json(sheet);

  const parametros: ParametroData[] = [];

  for (const row of data) {
    const empresaLegacy = String(row.empresa || '').trim();
    const param = String(row.param || '').trim();
    const param3 = String(row.param_3 || '').trim();
    let descripcion = String(row.descripcion || '').trim();
    const auxiliar = String(row.auxiliar || '').trim();

    // Si descripcion está vacía, usar auxiliar (caso de situación)
    if (!descripcion && auxiliar) {
      descripcion = auxiliar;
    }

    if (!empresaLegacy || !param || !param3 || !descripcion) {
      continue;
    }

    const { grupo, prefijo } = normalizarGrupo(param);
    const clave = `${prefijo}${param3.padStart(3, '0')}`;
    const esGlobal = empresaLegacy === '00';
    const categoria = categorizar(grupo, descripcion);

    parametros.push({
      grupo,
      clave,
      descripcion,
      categoria,
      esGlobal,
      empresaLegacy,
      descripcionOriginal: descripcion,
    });
  }

  return parametros;
}

// Leer empresas del archivo ue1.xls
function leerEmpresasLegacy(): EmpresaLegacy[] {
  const filePath = path.join(EXCELS_DIR, 'ue1.xls');
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const empresas: EmpresaLegacy[] = [];

  for (const row of data) {
    const id = String(row[0] || '').trim();
    const nombre = String(row[2] || '').trim();

    if (!id || !nombre || id === '00') {
      continue;
    }

    empresas.push({ id, nombre });
  }

  return empresas;
}

// Normalizar nombre para matching
function normalizarNombre(nombre: string): string {
  return nombre.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Main
async function main() {
  console.log('========================================');
  console.log('SEED DE PARÁMETROS - AMSA GESTIÓN');
  console.log('========================================\n');

  // 1. Leer empresas legacy del Excel
  console.log('1. Leyendo empresas del archivo ue1.xls...');
  const empresasLegacy = leerEmpresasLegacy();
  console.log(`   Total empresas en Excel: ${empresasLegacy.length}\n`);

  // 2. Cargar empresas existentes en DB
  console.log('2. Cargando empresas de la base de datos...');
  const empresasDB = await prisma.empresa.findMany();
  console.log(`   Total empresas en DB: ${empresasDB.length}\n`);

  // 3. Hacer matching de empresas legacy con DB
  console.log('3. Realizando matching de empresas...');
  const empresasNoEncontradas: string[] = [];
  const empresasMap = new Map<string, number>();

  for (const empLegacy of empresasLegacy) {
    const nombreNormalizado = normalizarNombre(empLegacy.nombre);
    const empresaDB = empresasDB.find(
      (e) => normalizarNombre(e.nombre) === nombreNormalizado
    );

    if (empresaDB) {
      empLegacy.dbId = empresaDB.id;
      empresasMap.set(empLegacy.id, empresaDB.id);
      console.log(`   ✓ ${empLegacy.id} → ${empLegacy.nombre} (DB ID: ${empresaDB.id})`);
    } else {
      empresasNoEncontradas.push(`${empLegacy.id} - ${empLegacy.nombre}`);
      console.log(`   ✗ ${empLegacy.id} → ${empLegacy.nombre} (NO ENCONTRADA EN DB)`);
    }
  }

  console.log(`\n   Empresas encontradas: ${empresasMap.size}`);
  console.log(`   Empresas NO encontradas: ${empresasNoEncontradas.length}\n`);

  // 4. Leer códigos de los archivos Excel
  console.log('4. Leyendo códigos de los archivos Excel...');
  const gestion = leerCodigosExcel('cod_gestion.xlsx');
  const situacion = leerCodigosExcel('cod_situacion.xlsx');
  const motivoNoPago = leerCodigosExcel('motnopago.xlsx');

  console.log(`   Gestión: ${gestion.length} códigos`);
  console.log(`   Situación: ${situacion.length} códigos`);
  console.log(`   Motivo No Pago: ${motivoNoPago.length} códigos\n`);

  const todosParametros = [...gestion, ...situacion, ...motivoNoPago];

  // 5. Agrupar parámetros por clave (para detectar duplicados y global)
  console.log('5. Procesando parámetros...');
  const parametrosPorClave = new Map<string, ParametroData[]>();

  for (const param of todosParametros) {
    if (!parametrosPorClave.has(param.clave)) {
      parametrosPorClave.set(param.clave, []);
    }
    parametrosPorClave.get(param.clave)!.push(param);
  }

  console.log(`   Total parámetros únicos: ${parametrosPorClave.size}\n`);

  // 6. Insertar/actualizar parámetros en la tabla parametro
  console.log('6. Insertando/actualizando parámetros en la DB...');
  let countParametrosCreados = 0;
  let countParametrosActualizados = 0;

  for (const [clave, variantes] of parametrosPorClave) {
    // Buscar si hay una variante global
    const varianteGlobal = variantes.find((v) => v.esGlobal);
    const parametroBase = varianteGlobal || variantes[0];

    const parametroExistente = await prisma.parametro.findUnique({
      where: { clave },
    });

    if (parametroExistente) {
      // Actualizar
      await prisma.parametro.update({
        where: { clave },
        data: {
          descripcion: parametroBase.descripcion,
          categoria: parametroBase.categoria,
          esGlobal: parametroBase.esGlobal,
        },
      });
      countParametrosActualizados++;
    } else {
      // Crear
      await prisma.parametro.create({
        data: {
          grupo: parametroBase.grupo,
          clave,
          descripcion: parametroBase.descripcion,
          categoria: parametroBase.categoria,
          esGlobal: parametroBase.esGlobal,
          activo: true,
        },
      });
      countParametrosCreados++;
    }
  }

  console.log(`   Parámetros creados: ${countParametrosCreados}`);
  console.log(`   Parámetros actualizados: ${countParametrosActualizados}\n`);

  // 7. Cargar parámetros de la DB para asociar con empresas
  console.log('7. Cargando parámetros de la DB para asociación...');
  const parametrosDB = await prisma.parametro.findMany();
  const parametrosDBMap = new Map(parametrosDB.map((p) => [p.clave, p]));
  console.log(`   Total parámetros en DB: ${parametrosDB.length}\n`);

  // 8. Crear/actualizar empresa_parametro
  console.log('8. Creando/actualizando asociaciones empresa_parametro...');
  let countEmpresaParametroCreados = 0;
  let countEmpresaParametroActualizados = 0;
  let countEmpresaParametroSkipped = 0;

  for (const [clave, variantes] of parametrosPorClave) {
    const parametroDB = parametrosDBMap.get(clave);
    if (!parametroDB) {
      console.log(`   ⚠ Parámetro ${clave} no encontrado en DB (saltando)`);
      continue;
    }

    // Buscar si hay una variante global
    const varianteGlobal = variantes.find((v) => v.esGlobal);

    if (varianteGlobal) {
      // Asociar con todas las empresas
      for (const empresaDB of empresasDB) {
        const existente = await prisma.empresa_parametro.findUnique({
          where: {
            empresaId_parametroId: {
              empresaId: empresaDB.id,
              parametroId: parametroDB.id,
            },
          },
        });

        if (existente) {
          countEmpresaParametroActualizados++;
        } else {
          await prisma.empresa_parametro.create({
            data: {
              empresaId: empresaDB.id,
              parametroId: parametroDB.id,
              activo: true,
            },
          });
          countEmpresaParametroCreados++;
        }
      }
    }

    // Procesar variantes específicas de empresa
    const variantesEspecificas = variantes.filter((v) => !v.esGlobal);

    for (const variante of variantesEspecificas) {
      const empresaDBId = empresasMap.get(variante.empresaLegacy);

      if (!empresaDBId) {
        countEmpresaParametroSkipped++;
        continue;
      }

      // Verificar si la descripción es diferente a la global
      let nombreOverride: string | undefined = undefined;
      if (varianteGlobal && variante.descripcion !== varianteGlobal.descripcion) {
        nombreOverride = variante.descripcion;
      }

      const existente = await prisma.empresa_parametro.findUnique({
        where: {
          empresaId_parametroId: {
            empresaId: empresaDBId,
            parametroId: parametroDB.id,
          },
        },
      });

      if (existente) {
        // Actualizar solo si hay override
        if (nombreOverride) {
          await prisma.empresa_parametro.update({
            where: {
              empresaId_parametroId: {
                empresaId: empresaDBId,
                parametroId: parametroDB.id,
              },
            },
            data: {
              nombreOverride,
            },
          });
        }
        countEmpresaParametroActualizados++;
      } else {
        await prisma.empresa_parametro.create({
          data: {
            empresaId: empresaDBId,
            parametroId: parametroDB.id,
            nombreOverride,
            activo: true,
          },
        });
        countEmpresaParametroCreados++;
      }
    }
  }

  console.log(`   Asociaciones creadas: ${countEmpresaParametroCreados}`);
  console.log(`   Asociaciones actualizadas: ${countEmpresaParametroActualizados}`);
  console.log(`   Asociaciones skipped (empresa no encontrada): ${countEmpresaParametroSkipped}\n`);

  // 9. Resumen final
  console.log('========================================');
  console.log('RESUMEN FINAL');
  console.log('========================================');
  console.log(`✓ Parámetros creados: ${countParametrosCreados}`);
  console.log(`✓ Parámetros actualizados: ${countParametrosActualizados}`);
  console.log(`✓ Asociaciones empresa_parametro creadas: ${countEmpresaParametroCreados}`);
  console.log(`✓ Asociaciones empresa_parametro actualizadas: ${countEmpresaParametroActualizados}`);

  if (empresasNoEncontradas.length > 0) {
    console.log(`\n⚠ EMPRESAS NO ENCONTRADAS EN DB (${empresasNoEncontradas.length}):`);
    empresasNoEncontradas.forEach((emp) => console.log(`  - ${emp}`));
  }

  console.log('\n¡Seed completado exitosamente!\n');
}

main()
  .catch((error) => {
    console.error('\n❌ Error durante el seed:');
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
