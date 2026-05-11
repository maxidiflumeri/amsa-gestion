import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { promises as fsp } from 'fs';

@Injectable()
export class ReportesStorageService {
  private readonly logger = new Logger(ReportesStorageService.name);
  private readonly storageRoot: string;

  constructor() {
    const root = process.env.REPORTES_STORAGE_PATH || './storage';
    this.storageRoot = path.resolve(root);
  }

  getStorageRoot(): string {
    return this.storageRoot;
  }

  async guardarArchivo(
    ejecucionId: number,
    extension: string,
    buffer: Buffer,
  ): Promise<{ filePath: string; tamano: number }> {
    const ahora = new Date();
    const anio = String(ahora.getFullYear());
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');

    const dir = path.join(this.storageRoot, 'reportes', anio, mes);
    await fsp.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${ejecucionId}.${extension}`);
    await fsp.writeFile(filePath, buffer);

    const stats = await fsp.stat(filePath);

    this.logger.log(
      `Archivo guardado: ${filePath} (${stats.size} bytes) ejecucionId=${ejecucionId}`,
    );

    return { filePath, tamano: stats.size };
  }

  async existeArchivo(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  abrirStream(filePath: string): fs.ReadStream {
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Archivo no encontrado: ${filePath}`);
    }
    return fs.createReadStream(filePath);
  }

  async eliminarArchivo(filePath: string): Promise<void> {
    try {
      await fsp.unlink(filePath);
      this.logger.log(`Archivo eliminado: ${filePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `No se pudo eliminar archivo ${filePath}: ${(error as Error).message}`,
        );
      }
    }
  }

  async tamanoArchivo(filePath: string): Promise<number | null> {
    try {
      const stats = await fsp.stat(filePath);
      return stats.size;
    } catch {
      return null;
    }
  }
}
