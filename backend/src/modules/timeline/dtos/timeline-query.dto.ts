import { IsOptional, IsString, IsInt, Min, Max, IsIn, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';

export class TimelineQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    page?: number = 0;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    size?: number = 30;

    @IsOptional()
    @IsString()
    @IsIn(['whatsapp', 'email', 'wapi'])
    canal?: 'whatsapp' | 'email' | 'wapi';

    @IsOptional()
    @IsISO8601()
    desde?: string;

    @IsOptional()
    @IsISO8601()
    hasta?: string;
}
