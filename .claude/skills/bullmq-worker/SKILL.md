---
name: bullmq-worker
description: >
  Crear o modificar workers, processors y queues de BullMQ en AMSA Sender.
  Usar este skill siempre que se mencione: worker, queue, job, BullMQ, cola de mensajes,
  procesamiento en background, retry, campaña en background, batch processing,
  envío masivo (email o WhatsApp), o cualquier tarea asíncrona con Redis.
---

# Skill: BullMQ Worker — AMSA Sender

## Estructura

```
src/
└── <modulo>/
    ├── queues/
    │   └── <nombre>.queue.ts       # Definición de la queue
    ├── processors/
    │   └── <nombre>.processor.ts   # Worker/processor principal
    └── <nombre>.module.ts          # Registrar BullModule aquí
```

## Definir la Queue

```typescript
// queues/email-campana.queue.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

export const EMAIL_CAMPANA_QUEUE = 'email-campana';

@Injectable()
export class EmailCampanaQueue {
  private readonly logger = new Logger(EmailCampanaQueue.name);

  constructor(
    @InjectQueue(EMAIL_CAMPANA_QUEUE) private readonly queue: Queue,
  ) {}

  async agregarJob(data: EmailJobData, opts?: JobOpts) {
    const job = await this.queue.add('enviar-email', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
      ...opts,
    });
    this.logger.log(`Job agregado: ${job.id} para campaña ${data.campanaId}`);
    return job;
  }
}
```

## Processor / Worker

```typescript
// processors/email-campana.processor.ts
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EMAIL_CAMPANA_QUEUE } from '../queues/email-campana.queue';

@Processor(EMAIL_CAMPANA_QUEUE, {
  concurrency: 3, // ajustar según carga
})
export class EmailCampanaProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailCampanaProcessor.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    this.logger.log(`Procesando job ${job.id} — campaña ${job.data.campanaId}`);

    try {
      await job.updateProgress(0);
      
      const { campanaId, destinatarios, batchSize = 50, delayMs = 1000 } = job.data;

      const total = destinatarios.length;
      let enviados = 0;

      for (let i = 0; i < total; i += batchSize) {
        const batch = destinatarios.slice(i, i + batchSize);

        await Promise.allSettled(
          batch.map((dest) => this.emailService.enviar(dest, campanaId)),
        );

        enviados += batch.length;
        const progreso = Math.round((enviados / total) * 100);
        await job.updateProgress(progreso);

        this.logger.log(`Campaña ${campanaId}: ${enviados}/${total} enviados`);

        // Respetar delay entre batches
        if (i + batchSize < total) {
          await this.sleep(delayMs);
        }
      }

      await this.prisma.campana.update({
        where: { id: campanaId },
        data: { estado: 'COMPLETADA', completadoEn: new Date() },
      });

      this.logger.log(`Campaña ${campanaId} completada exitosamente`);
    } catch (error) {
      this.logger.error(
        `Error procesando job ${job.id} — campaña ${job.data.campanaId}`,
        error?.stack,
      );
      throw error; // Re-throw para que BullMQ aplique el retry
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completado`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} falló: ${error.message}`);
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`Job ${jobId} está stalled`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

## Registrar en el módulo

```typescript
@Module({
  imports: [
    BullModule.registerQueue({
      name: EMAIL_CAMPANA_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
    PrismaModule,
  ],
  providers: [EmailCampanaQueue, EmailCampanaProcessor, EmailService],
  exports: [EmailCampanaQueue],
})
export class EmailModule {}
```

## Soporte de pausa / reanudación

```typescript
// En el servicio que controla la campaña
async pausarCampana(campanaId: number) {
  await this.queue.pause();
  await this.prisma.campana.update({
    where: { id: campanaId },
    data: { estado: 'PAUSADA' },
  });
  this.logger.log(`Campaña ${campanaId} pausada`);
}

async reanudarCampana(campanaId: number) {
  await this.queue.resume();
  await this.prisma.campana.update({
    where: { id: campanaId },
    data: { estado: 'EN_PROGRESO' },
  });
  this.logger.log(`Campaña ${campanaId} reanudada`);
}
```

## Emitir progreso por Socket.io

Si el módulo de sockets está disponible, emitir desde el processor:

```typescript
// Inyectar el gateway o un servicio de sockets
this.socketService.emitirProgreso(campanaId, {
  enviados,
  total,
  progreso,
  estado: 'EN_PROGRESO',
});
```

## Checklist antes de entregar

- [ ] ¿El processor tiene `@OnWorkerEvent` para `completed`, `failed` y `stalled`?
- [ ] ¿Los jobs tienen `attempts` y `backoff` configurados?
- [ ] ¿Se re-lanza el error en `catch` para que BullMQ aplique retry?
- [ ] ¿Se actualiza el progreso con `job.updateProgress()`?
- [ ] ¿El estado de la campaña en Prisma se actualiza al completar/fallar?
- [ ] ¿No hay ningún `console.log`?
