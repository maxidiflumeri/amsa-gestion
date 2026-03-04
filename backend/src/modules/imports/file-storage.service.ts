// src/import/file-storage.service.ts
import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class FileStorageService {
    baseDir = path.resolve(process.cwd(), 'uploads');

    async saveBuffer(file: any, empresaId: number, categoria: string) {
        const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
        const dir = path.join(this.baseDir, String(empresaId), categoria);
        await fs.mkdir(dir, { recursive: true });
        const filename = `${Date.now()}_${hash}.dat`;
        const full = path.join(dir, filename);
        await fs.writeFile(full, file.buffer);
        return { path: full, hash, filename };
    }
}