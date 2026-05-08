import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export interface ProgresoEjecucionPayload {
  ejecucionId: number;
  progreso: number;
  filasProcesadas: number;
  totalFilas?: number | null;
  fase: string;
}

export interface CompletadoEjecucionPayload {
  ejecucionId: number;
  archivoTamano: number | null;
  totalFilas: number | null;
  duracionMs: number;
}

export interface FallidoEjecucionPayload {
  ejecucionId: number;
  error: string;
}

const NAMESPACE = '/reportes-v2';

@WebSocketGateway({
  namespace: NAMESPACE,
  cors: {
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://amsasender.anamayasa.com',
    ],
    credentials: true,
  },
})
export class ReportesV2Gateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ReportesV2Gateway.name);

  handleConnection(client: Socket): void {
    const usuarioId = this.extractUsuarioId(client);

    if (usuarioId === null) {
      this.logger.warn(
        `Cliente ${client.id} conectado sin usuarioId, será desconectado`,
      );
      client.disconnect(true);
      return;
    }

    const room = this.roomFor(usuarioId);
    void client.join(room);

    this.logger.log(
      `Cliente ${client.id} conectado a ${NAMESPACE}, usuarioId=${usuarioId}, room=${room}`,
    );
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Cliente ${client.id} desconectado de ${NAMESPACE}`);
  }

  emitProgreso(usuarioId: number, payload: ProgresoEjecucionPayload): void {
    this.server
      .to(this.roomFor(usuarioId))
      .emit('ejecucion:progreso', payload);
  }

  emitCompletado(
    usuarioId: number,
    payload: CompletadoEjecucionPayload,
  ): void {
    this.server
      .to(this.roomFor(usuarioId))
      .emit('ejecucion:completado', payload);
  }

  emitFallido(usuarioId: number, payload: FallidoEjecucionPayload): void {
    this.server.to(this.roomFor(usuarioId)).emit('ejecucion:fallido', payload);
  }

  private roomFor(usuarioId: number): string {
    return `usuario:${usuarioId}`;
  }

  private extractUsuarioId(client: Socket): number | null {
    const fromAuth = (client.handshake.auth as Record<string, any>)?.usuarioId;
    const fromQuery = client.handshake.query?.usuarioId;

    const candidate = fromAuth ?? fromQuery;
    if (candidate === undefined || candidate === null) {
      return null;
    }

    const parsed =
      typeof candidate === 'number' ? candidate : parseInt(String(candidate), 10);

    if (Number.isNaN(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  }
}
