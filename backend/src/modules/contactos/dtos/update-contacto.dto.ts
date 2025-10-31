import { PartialType } from '@nestjs/mapped-types';
import { CreateContactoDto } from './create-contacto.dto';

export class UpdateContactoDto extends PartialType(CreateContactoDto) {}