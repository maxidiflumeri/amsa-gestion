import { Test, TestingModule } from '@nestjs/testing';
import { DeudoresController } from './deudores.controller';

describe('DeudoresController', () => {
  let controller: DeudoresController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeudoresController],
    }).compile();

    controller = module.get<DeudoresController>(DeudoresController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
