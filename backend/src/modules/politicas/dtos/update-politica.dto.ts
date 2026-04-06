import { PartialType } from '@nestjs/mapped-types';
import { CreatePoliticaDto } from './create-politica.dto';

export class UpdatePoliticaDto extends PartialType(CreatePoliticaDto) {}
