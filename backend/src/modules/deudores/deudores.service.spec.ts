import { Test, TestingModule } from '@nestjs/testing';
import { DeudoresService } from './deudores.service';

describe('DeudoresService', () => {
  let service: DeudoresService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeudoresService],
    }).compile();

    service = module.get<DeudoresService>(DeudoresService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
