---
name: prisma-migration
description: >
  Modificar el schema de Prisma, generar migraciones y seeds en AMSA Sender.
  Usar este skill siempre que se pida agregar o modificar un modelo de base de datos,
  crear una relación entre tablas, agregar un campo, cambiar un tipo, generar una
  migración, crear un seed, o cualquier cambio que afecte schema.prisma o la base de datos MySQL.
---

# Skill: Prisma + MySQL — AMSA Sender

## Convenciones de schema

- Nombres de modelos en **PascalCase** (ej: `CampanaEmail`)
- Nombres de campos en **camelCase** (ej: `creadoEn`)
- Siempre incluir `id`, `creadoEn`, `actualizadoEn` en cada modelo
- Estados de campaña como `enum`, nunca strings libres

## Plantilla de modelo

```prisma
model CampanaEmail {
  id              Int              @id @default(autoincrement())
  nombre          String
  estado          EstadoCampana    @default(BORRADOR)
  asunto          String
  htmlContenido   String           @db.LongText
  programadaEn    DateTime?
  completadaEn    DateTime?
  creadoEn        DateTime         @default(now())
  actualizadoEn   DateTime         @updatedAt

  // Relaciones
  cuentaSmtp      CuentaSmtp       @relation(fields: [cuentaSmtpId], references: [id])
  cuentaSmtpId    Int
  destinatarios   Destinatario[]

  @@map("campanas_email")
}

enum EstadoCampana {
  BORRADOR
  PROGRAMADA
  EN_PROGRESO
  PAUSADA
  COMPLETADA
  FALLIDA
}
```

## Flujo para modificar el schema

### 1. Editar `schema.prisma`
### 2. Crear la migración

```bash
# Migración con nombre descriptivo (snake_case)
npx prisma migrate dev --name agregar_cuenta_smtp

# Si hay cambios que requieren reset en dev
npx prisma migrate reset
```

### 3. Regenerar el cliente

```bash
npx prisma generate
```

### 4. Verificar en Prisma Studio (opcional)

```bash
npx prisma studio
```

## Relaciones comunes en AMSA Sender

### Uno a muchos

```prisma
model CuentaSmtp {
  id         Int             @id @default(autoincrement())
  host       String
  puerto     Int
  usuario    String
  campanas   CampanaEmail[]

  @@map("cuentas_smtp")
}
```

### Muchos a muchos implícito

```prisma
model Campana {
  etiquetas  Etiqueta[]
}

model Etiqueta {
  campanas   Campana[]
}
```

### Muchos a muchos explícito (con datos extra)

```prisma
model CampanaDestinatario {
  id           Int       @id @default(autoincrement())
  campanaId    Int
  contactoId   Int
  estado       String    @default("PENDIENTE")
  enviadoEn    DateTime?

  campana      Campana   @relation(fields: [campanaId], references: [id])
  contacto     Contacto  @relation(fields: [contactoId], references: [id])

  @@unique([campanaId, contactoId])
  @@map("campana_destinatarios")
}
```

## Uso de Prisma en servicios NestJS

```typescript
// Siempre inyectar PrismaService, nunca instanciar directamente
@Injectable()
export class CampanaEmailService {
  private readonly logger = new Logger(CampanaEmailService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Usar transacciones para operaciones multi-tabla
  async crearCampanaConDestinatarios(dto: CreateCampanaDto) {
    return this.prisma.$transaction(async (tx) => {
      const campana = await tx.campanaEmail.create({
        data: {
          nombre: dto.nombre,
          asunto: dto.asunto,
          htmlContenido: dto.htmlContenido,
          cuentaSmtpId: dto.cuentaSmtpId,
        },
      });

      await tx.destinatario.createMany({
        data: dto.destinatarios.map((email) => ({
          email,
          campanaEmailId: campana.id,
        })),
      });

      this.logger.log(`Campaña ${campana.id} creada con ${dto.destinatarios.length} destinatarios`);
      return campana;
    });
  }
}
```

## Seed

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Usar upsert para idempotencia
  await prisma.cuentaSmtp.upsert({
    where: { usuario: 'test@amsa.com' },
    update: {},
    create: {
      host: 'smtp.gmail.com',
      puerto: 587,
      usuario: 'test@amsa.com',
      password: 'test123',
    },
  });

  console.info('Seed completado'); // Permitido en seed, no en producción
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

```json
// package.json
"prisma": {
  "seed": "ts-node prisma/seed.ts"
}
```

```bash
npx prisma db seed
```

## Checklist antes de entregar

- [ ] ¿El modelo tiene `id`, `creadoEn`, `actualizadoEn`?
- [ ] ¿Los estados usan `enum` de Prisma, no strings libres?
- [ ] ¿Las relaciones tienen `@@map` con nombre de tabla en snake_case?
- [ ] ¿Se generó la migración con nombre descriptivo?
- [ ] ¿Se corrió `npx prisma generate` después del cambio?
- [ ] ¿Las operaciones multi-tabla usan `$transaction`?
