import { ReportesStorageService } from './reportes-storage.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ReportesStorageService', () => {
  let svc: ReportesStorageService;
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reportes-v2-test-'));
    process.env.REPORTES_V2_STORAGE_PATH = tmpRoot;
    svc = new ReportesStorageService();
  });

  afterEach(() => {
    delete process.env.REPORTES_V2_STORAGE_PATH;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('guarda archivo y devuelve path absoluto + tamano', async () => {
    const buf = Buffer.from('hola mundo');
    const result = await svc.guardarArchivo(42, 'csv', buf);

    expect(path.isAbsolute(result.filePath)).toBe(true);
    expect(result.tamano).toBe(buf.length);
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath.endsWith('42.csv')).toBe(true);
  });

  it('crea estructura anio/mes', async () => {
    const buf = Buffer.from('x');
    const result = await svc.guardarArchivo(1, 'xlsx', buf);
    const ahora = new Date();
    const anio = String(ahora.getFullYear());
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    expect(result.filePath).toContain(path.join('reportes', 'v2', anio, mes));
  });

  it('elimina archivo existente sin error', async () => {
    const { filePath } = await svc.guardarArchivo(7, 'csv', Buffer.from('a'));
    await svc.eliminarArchivo(filePath);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('eliminar archivo inexistente no lanza', async () => {
    await expect(
      svc.eliminarArchivo(path.join(tmpRoot, 'no-existe.csv')),
    ).resolves.not.toThrow();
  });

  it('existeArchivo true/false segun corresponda', async () => {
    const { filePath } = await svc.guardarArchivo(8, 'txt', Buffer.from('b'));
    expect(await svc.existeArchivo(filePath)).toBe(true);
    expect(await svc.existeArchivo(path.join(tmpRoot, 'nope.txt'))).toBe(false);
  });
});
