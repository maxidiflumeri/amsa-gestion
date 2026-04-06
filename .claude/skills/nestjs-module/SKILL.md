---
name: nestjs-module
description: >
  Crear, modificar o extender módulos NestJS en AMSA Sender. Usar este skill
  siempre que se pida crear un módulo, servicio, controlador, guard, interceptor,
  pipe o cualquier artefacto del backend NestJS. También aplicar cuando se pida
  agregar un endpoint, refactorizar un servicio existente, o integrar una librería
  nueva al backend.
---

# Skill: Módulo NestJS — AMSA Sender

## Estructura de archivos

Cada módulo sigue esta estructura:

```
src/
└── <nombre>/
    ├── <nombre>.module.ts
    ├── <nombre>.controller.ts
    ├── <nombre>.service.ts
    ├── dto/
    │   ├── create-<nombre>.dto.ts
    │   └── update-<nombre>.dto.ts
    └── interfaces/
        └── <nombre>.interface.ts
```

## Convenciones obligatorias

### Logger
Siempre inyectar y usar Winston. NUNCA `console.log`.

```typescript
import { Logger } from '@nestjs/common';

@Injectable()
export class MiServicio {
  private readonly logger = new Logger(MiServicio.name);

  async hacerAlgo() {
    this.logger.log('Iniciando proceso...');
    try {
      // lógica
    } catch (error) {
      this.logger.error('Error en hacerAlgo', error?.stack);
      throw new HttpException('Error interno', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
```

### DTOs
Siempre usar `class-validator` y `class-transformer`.

```typescript
import { IsString, IsEmail, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator';

export class CreateCampanaDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsEmail()
  destinatario: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  batchSize?: number;
}
```

### Controladores
- Siempre decorar con `@ApiTags` (Swagger).
- Usar `@HttpCode` explícito en creación/eliminación.
- Capturar errores con filtros globales, no try/catch en el controller.

```typescript
@ApiTags('campanas')
@Controller('campanas')
export class CampanaController {
  constructor(private readonly campanaService: CampanaService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCampanaDto) {
    return this.campanaService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.campanaService.findOne(id);
  }
}
```

### Módulo
- Siempre declarar `exports` para servicios que otros módulos consuman.
- Importar `PrismaModule` si el servicio accede a la DB.

```typescript
@Module({
  imports: [PrismaModule],
  controllers: [CampanaController],
  providers: [CampanaService],
  exports: [CampanaService],
})
export class CampanaModule {}
```

## Manejo de errores

```typescript
// Preferir excepciones específicas de NestJS
throw new NotFoundException(`Campaña con id ${id} no encontrada`);
throw new BadRequestException('El campo nombre es requerido');
throw new ConflictException('Ya existe una campaña con ese nombre');
```

## Integración con Prisma

```typescript
@Injectable()
export class CampanaService {
  private readonly logger = new Logger(CampanaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findOne(id: number) {
    const campana = await this.prisma.campana.findUnique({ where: { id } });
    if (!campana) throw new NotFoundException(`Campaña ${id} no encontrada`);
    return campana;
  }
}
```

## Checklist antes de entregar

- [ ] ¿El módulo está registrado en `AppModule`?
- [ ] ¿Todos los métodos del servicio tienen logger?
- [ ] ¿Los DTOs tienen validaciones con `class-validator`?
- [ ] ¿Los errores usan `HttpException` de NestJS?
- [ ] ¿Se exportan los servicios que otros módulos necesitan?
- [ ] ¿Hay algún `console.log` residual? (eliminar)
