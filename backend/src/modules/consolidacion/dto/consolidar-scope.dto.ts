import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';

export class ConsolidarScopeDto {
    @IsIn(['REMESA', 'EMPRESA', 'TODAS'])
    tipo: 'REMESA' | 'EMPRESA' | 'TODAS';

    /**
     * Requerido cuando tipo === 'REMESA'.
     * Ignorado en otros scopes.
     */
    @IsOptional()
    @IsInt()
    @IsPositive()
    remesaId?: number;

    /**
     * Requerido cuando tipo === 'EMPRESA'.
     * Ignorado en otros scopes.
     */
    @IsOptional()
    @IsInt()
    @IsPositive()
    empresaId?: number;
}
