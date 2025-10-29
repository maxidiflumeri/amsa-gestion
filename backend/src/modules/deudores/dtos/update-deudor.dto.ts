import { PartialType } from '@nestjs/mapped-types';
import { CreateDeudorDto } from './create-deudor.dto';

export class UpdateDeudorDto extends PartialType(CreateDeudorDto) { }