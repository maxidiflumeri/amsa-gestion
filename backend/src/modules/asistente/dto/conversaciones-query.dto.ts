import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ConversacionesQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limite?: number;
}
