import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ClientsService } from '../src/clients/clients.service';
import { Client } from '../src/entities/client.entity';
import { CreateClientDto, UpdateClientDto } from '../src/clients/dto/client.dto';
import { PaginationDto } from '../src/core/dto/pagination.dto';

describe('ClientsService', () => {
  let service: ClientsService;
  let mockClientRepository: any;

  beforeEach(async () => {
    mockClientRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        {
          provide: getRepositoryToken(Client),
          useValue: mockClientRepository,
        },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return clients with default pagination', async () => {
      const userId = 'user-id';
      const clients = [
        {
          id: 'client-1',
          userId,
          name: 'Client 1',
          email: 'client1@example.com',
          createdAt: new Date(),
        },
        {
          id: 'client-2',
          userId,
          name: 'Client 2',
          email: 'client2@example.com',
          createdAt: new Date(),
        },
      ];
      const total = 2;

      mockClientRepository.findAndCount.mockResolvedValue([clients, total]);

      const result = await service.findAll(userId);

      expect(mockClientRepository.findAndCount).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result.data).toEqual(clients);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('should return clients with custom pagination', async () => {
      const userId = 'user-id';
      const pagination: PaginationDto = {
        page: 2,
        limit: 10,
      };
      const clients = [
        {
          id: 'client-1',
          userId,
          name: 'Client 1',
          createdAt: new Date(),
        },
      ];
      const total = 25;

      mockClientRepository.findAndCount.mockResolvedValue([clients, total]);

      const result = await service.findAll(userId, pagination);

      expect(mockClientRepository.findAndCount).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
        order: { createdAt: 'DESC' },
        skip: 10, // (page - 1) * limit = (2 - 1) * 10 = 10
        take: 10,
      });
      expect(result.data).toEqual(clients);
      expect(result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3, // Math.ceil(25 / 10) = 3
      });
    });

    it('should return empty array when no clients found', async () => {
      const userId = 'user-id';
      const clients: Client[] = [];
      const total = 0;

      mockClientRepository.findAndCount.mockResolvedValue([clients, total]);

      const result = await service.findAll(userId);

      expect(mockClientRepository.findAndCount).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });

    it('should filter by userId', async () => {
      const userId = 'user-id';
      const clients: Client[] = [];
      const total = 0;

      mockClientRepository.findAndCount.mockResolvedValue([clients, total]);

      await service.findAll(userId);

      expect(mockClientRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, deletedAt: null },
        }),
      );
    });

    it('should order by createdAt DESC', async () => {
      const userId = 'user-id';
      const clients: Client[] = [];
      const total = 0;

      mockClientRepository.findAndCount.mockResolvedValue([clients, total]);

      await service.findAll(userId);

      expect(mockClientRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { createdAt: 'DESC' },
        }),
      );
    });

    it('should calculate totalPages correctly', async () => {
      const userId = 'user-id';
      const clients: Client[] = [];
      const total = 25;
      const pagination: PaginationDto = {
        page: 1,
        limit: 10,
      };

      mockClientRepository.findAndCount.mockResolvedValue([clients, total]);

      const result = await service.findAll(userId, pagination);

      expect(result.meta.totalPages).toBe(3); // Math.ceil(25 / 10) = 3
    });
  });

  describe('findOne', () => {
    it('should return client when found with matching userId', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const client = {
        id,
        userId,
        name: 'Test Client',
        email: 'test@example.com',
        deletedAt: null,
      };

      mockClientRepository.findOne.mockResolvedValue(client);

      const result = await service.findOne(id, userId);

      expect(mockClientRepository.findOne).toHaveBeenCalledWith({
        where: { id, deletedAt: null },
      });
      expect(result).toEqual(client);
    });

    it('should throw NotFoundException when client is not found', async () => {
      const id = 'non-existent-id';
      const userId = 'user-id';

      mockClientRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(id, userId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(id, userId)).rejects.toThrow(
        'Client not found',
      );
    });

    it('should throw ForbiddenException when userId does not match', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const differentUserId = 'different-user-id';
      const client = {
        id,
        userId: differentUserId,
        name: 'Test Client',
        deletedAt: null,
      };

      mockClientRepository.findOne.mockResolvedValue(client);

      await expect(service.findOne(id, userId)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.findOne(id, userId)).rejects.toThrow(
        'Access denied',
      );
    });

    it('should query with deletedAt null', async () => {
      const id = 'client-id';
      const userId = 'user-id';

      mockClientRepository.findOne.mockResolvedValue(null);

      try {
        await service.findOne(id, userId);
      } catch (error) {
        // Expected to throw
      }

      expect(mockClientRepository.findOne).toHaveBeenCalledWith({
        where: { id, deletedAt: null },
      });
    });
  });

  describe('create', () => {
    it('should create a new client with all fields', async () => {
      const userId = 'user-id';
      const createClientDto: CreateClientDto = {
        name: 'New Client',
        email: 'newclient@example.com',
        phone: '+1234567890',
        addressJson: { street: '123 Main St', city: 'New York' },
      };

      const createdClient = {
        id: 'client-id',
        userId,
        ...createClientDto,
      };

      mockClientRepository.create.mockReturnValue(createdClient);
      mockClientRepository.save.mockResolvedValue(createdClient);

      const result = await service.create(createClientDto, userId);

      expect(mockClientRepository.create).toHaveBeenCalledWith({
        ...createClientDto,
        userId,
      });
      expect(mockClientRepository.save).toHaveBeenCalledWith(createdClient);
      expect(result).toEqual(createdClient);
    });

    it('should create a client with minimal required fields', async () => {
      const userId = 'user-id';
      const createClientDto: CreateClientDto = {
        name: 'Minimal Client',
      };

      const createdClient = {
        id: 'client-id',
        userId,
        name: createClientDto.name,
      };

      mockClientRepository.create.mockReturnValue(createdClient);
      mockClientRepository.save.mockResolvedValue(createdClient);

      const result = await service.create(createClientDto, userId);

      expect(mockClientRepository.create).toHaveBeenCalledWith({
        ...createClientDto,
        userId,
      });
      expect(mockClientRepository.save).toHaveBeenCalledWith(createdClient);
      expect(result).toEqual(createdClient);
    });

    it('should add userId to client data', async () => {
      const userId = 'user-id';
      const createClientDto: CreateClientDto = {
        name: 'Test Client',
      };

      const createdClient = {
        id: 'client-id',
        ...createClientDto,
        userId,
      };

      mockClientRepository.create.mockReturnValue(createdClient);
      mockClientRepository.save.mockResolvedValue(createdClient);

      await service.create(createClientDto, userId);

      expect(mockClientRepository.create).toHaveBeenCalledWith({
        ...createClientDto,
        userId,
      });
    });
  });

  describe('update', () => {
    it('should update existing client', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const updateClientDto: UpdateClientDto = {
        name: 'Updated Client',
        email: 'updated@example.com',
      };

      const existingClient = {
        id,
        userId,
        name: 'Original Client',
        email: 'original@example.com',
        deletedAt: null,
      };

      const updatedClient = {
        ...existingClient,
        ...updateClientDto,
      };

      mockClientRepository.findOne.mockResolvedValue(existingClient);
      mockClientRepository.save.mockResolvedValue(updatedClient);

      const result = await service.update(id, updateClientDto, userId);

      expect(mockClientRepository.findOne).toHaveBeenCalledWith({
        where: { id, deletedAt: null },
      });
      expect(mockClientRepository.save).toHaveBeenCalledWith(updatedClient);
      expect(result).toEqual(updatedClient);
    });

    it('should throw NotFoundException when client is not found', async () => {
      const id = 'non-existent-id';
      const userId = 'user-id';
      const updateClientDto: UpdateClientDto = {
        name: 'Updated Client',
      };

      mockClientRepository.findOne.mockResolvedValue(null);

      await expect(service.update(id, updateClientDto, userId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockClientRepository.save).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when userId does not match', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const differentUserId = 'different-user-id';
      const updateClientDto: UpdateClientDto = {
        name: 'Updated Client',
      };

      const client = {
        id,
        userId: differentUserId,
        name: 'Test Client',
        deletedAt: null,
      };

      mockClientRepository.findOne.mockResolvedValue(client);

      await expect(service.update(id, updateClientDto, userId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockClientRepository.save).not.toHaveBeenCalled();
    });

    it('should perform partial update', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const updateClientDto: UpdateClientDto = {
        name: 'Updated Name Only',
      };

      const existingClient = {
        id,
        userId,
        name: 'Original Client',
        email: 'original@example.com',
        phone: '+1234567890',
        deletedAt: null,
      };

      const updatedClient = {
        ...existingClient,
        name: updateClientDto.name,
      };

      mockClientRepository.findOne.mockResolvedValue(existingClient);
      mockClientRepository.save.mockResolvedValue(updatedClient);

      const result = await service.update(id, updateClientDto, userId);

      expect(result.name).toBe(updateClientDto.name);
      expect(result.email).toBe(existingClient.email);
      expect(result.phone).toBe(existingClient.phone);
    });

    it('should call findOne first for ownership check', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const updateClientDto: UpdateClientDto = {
        name: 'Updated Client',
      };

      const existingClient = {
        id,
        userId,
        name: 'Original Client',
        deletedAt: null,
      };

      mockClientRepository.findOne.mockResolvedValue(existingClient);
      mockClientRepository.save.mockResolvedValue({
        ...existingClient,
        ...updateClientDto,
      });

      await service.update(id, updateClientDto, userId);

      // Verify findOne is called before save (ownership check first)
      const findOneCallOrder = mockClientRepository.findOne.mock.invocationCallOrder[0];
      const saveCallOrder = mockClientRepository.save.mock.invocationCallOrder[0];
      expect(findOneCallOrder).toBeLessThan(saveCallOrder);
    });
  });

  describe('archive', () => {
    it('should archive a client by setting deletedAt', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const client = {
        id,
        userId,
        name: 'Test Client',
        deletedAt: null,
      };

      const archivedClient = {
        ...client,
        deletedAt: new Date(),
      };

      mockClientRepository.findOne.mockResolvedValue(client);
      mockClientRepository.save.mockResolvedValue(archivedClient);

      await service.archive(id, userId);

      expect(mockClientRepository.findOne).toHaveBeenCalledWith({
        where: { id, deletedAt: null },
      });
      expect(mockClientRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          deletedAt: expect.any(Date),
        }),
      );
    });

    it('should throw NotFoundException when client is not found', async () => {
      const id = 'non-existent-id';
      const userId = 'user-id';

      mockClientRepository.findOne.mockResolvedValue(null);

      await expect(service.archive(id, userId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockClientRepository.save).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when userId does not match', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const differentUserId = 'different-user-id';
      const client = {
        id,
        userId: differentUserId,
        name: 'Test Client',
        deletedAt: null,
      };

      mockClientRepository.findOne.mockResolvedValue(client);

      await expect(service.archive(id, userId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockClientRepository.save).not.toHaveBeenCalled();
    });

    it('should set deletedAt to current date', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const beforeArchive = new Date();
      const client = {
        id,
        userId,
        name: 'Test Client',
        deletedAt: null,
      };

      mockClientRepository.findOne.mockResolvedValue(client);
      mockClientRepository.save.mockImplementation((clientToSave) => {
        return Promise.resolve(clientToSave);
      });

      await service.archive(id, userId);

      const savedClient = mockClientRepository.save.mock.calls[0][0];
      expect(savedClient.deletedAt).toBeInstanceOf(Date);
      expect(savedClient.deletedAt.getTime()).toBeGreaterThanOrEqual(
        beforeArchive.getTime(),
      );
    });

    it('should return void', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const client = {
        id,
        userId,
        name: 'Test Client',
        deletedAt: null,
      };

      mockClientRepository.findOne.mockResolvedValue(client);
      mockClientRepository.save.mockResolvedValue({
        ...client,
        deletedAt: new Date(),
      });

      const result = await service.archive(id, userId);

      expect(result).toBeUndefined();
    });

    it('should call findOne first for ownership check', async () => {
      const id = 'client-id';
      const userId = 'user-id';
      const client = {
        id,
        userId,
        name: 'Test Client',
        deletedAt: null,
      };

      mockClientRepository.findOne.mockResolvedValue(client);
      mockClientRepository.save.mockResolvedValue({
        ...client,
        deletedAt: new Date(),
      });

      await service.archive(id, userId);

      // Verify findOne is called before save (ownership check first)
      const findOneCallOrder = mockClientRepository.findOne.mock.invocationCallOrder[0];
      const saveCallOrder = mockClientRepository.save.mock.invocationCallOrder[0];
      expect(findOneCallOrder).toBeLessThan(saveCallOrder);
    });
  });
});

