import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ParametrosService {
    constructor(private prisma: PrismaService) { }

    findByGrupo(grupo: string) {
        return this.prisma.parametro.findMany({
            where: { grupo },
            orderBy: { id: 'asc' },
        });
    }
}