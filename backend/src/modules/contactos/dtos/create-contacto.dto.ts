import { IsInt, IsString, IsNotEmpty } from 'class-validator';

export class CreateContactoDto {
    @IsString()
    @IsNotEmpty()
    tipo: string;

    @IsString()
    @IsNotEmpty()
    valor: string;

    @IsInt()
    deudorId: number;
}