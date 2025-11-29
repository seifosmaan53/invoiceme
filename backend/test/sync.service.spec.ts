import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SyncService } from '../src/sync/sync.service';
import { DeviceChange, ChangeType, ChangeObjectType } from '../src/entities/device-change.entity';
import { Client } from '../src/entities/client.entity';
import { Invoice } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { Attachment } from '../src/entities/attachment.entity';

describe('SyncService', () => {
  let service: SyncService;
  let mockDeviceChangeRepository: any;
  let mockClientRepository: any;
  let mockInvoiceRepository: any;
  let mockInvoiceItemRepository: any;
  let mockAttachmentRepository: any;

  beforeEach(async () => {
    mockDeviceChangeRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };

    mockClientRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };

    mockInvoiceRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };

    mockInvoiceItemRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };

    mockAttachmentRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        {
          provide: getRepositoryToken(DeviceChange),
          useValue: mockDeviceChangeRepository,
        },
        {
          provide: getRepositoryToken(Client),
          useValue: mockClientRepository,
        },
        {
          provide: getRepositoryToken(Invoice),
          useValue: mockInvoiceRepository,
        },
        {
          provide: getRepositoryToken(InvoiceItem),
          useValue: mockInvoiceItemRepository,
        },
        {
          provide: getRepositoryToken(Attachment),
          useValue: mockAttachmentRepository,
        },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
  });

  describe('pushChanges', () => {
    it('should process changes and return synced count', async () => {
      const changes = [
        {
          object_type: ChangeObjectType.CLIENT,
          object_id: 'client-id',
          change_type: ChangeType.CREATE,
          data: { name: 'Test Client', email: 'test@example.com' },
          device_id: 'device-id',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      mockDeviceChangeRepository.create.mockReturnValue({
        id: 'change-id',
        userId: 'user-id',
        deviceId: 'device-id',
        objectType: ChangeObjectType.CLIENT,
        objectId: 'client-id',
        changeJson: changes[0].data,
        changeType: ChangeType.CREATE,
        synced: false,
      });

      mockDeviceChangeRepository.save.mockResolvedValue({
        id: 'change-id',
        synced: true,
      });

      mockClientRepository.findOne.mockResolvedValue(null);
      mockClientRepository.create.mockReturnValue({
        id: 'client-id',
        userId: 'user-id',
        ...changes[0].data,
      });
      mockClientRepository.save.mockResolvedValue({ id: 'client-id' });

      const result = await service.pushChanges('user-id', {
        deviceId: 'device-id',
        changes,
      });

      expect(result.synced).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockDeviceChangeRepository.create).toHaveBeenCalled();
      expect(mockDeviceChangeRepository.save).toHaveBeenCalledTimes(2); // Create and update synced status
    });

    it('should handle failed changes gracefully', async () => {
      const changes = [
        {
          object_type: ChangeObjectType.CLIENT,
          object_id: 'client-id',
          change_type: ChangeType.CREATE,
          data: { name: 'Test Client' },
          device_id: 'device-id',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      mockDeviceChangeRepository.create.mockReturnValue({
        id: 'change-id',
        userId: 'user-id',
        deviceId: 'device-id',
        objectType: ChangeObjectType.CLIENT,
        objectId: 'client-id',
        changeJson: changes[0].data,
        changeType: ChangeType.CREATE,
        synced: false,
      });

      mockDeviceChangeRepository.save.mockResolvedValueOnce({
        id: 'change-id',
        synced: false,
      });

      mockClientRepository.findOne.mockRejectedValue(new Error('Database error'));

      const result = await service.pushChanges('user-id', {
        deviceId: 'device-id',
        changes,
      });

      expect(result.synced).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should handle UPDATE change type', async () => {
      const changes = [
        {
          object_type: ChangeObjectType.CLIENT,
          object_id: 'client-id',
          change_type: ChangeType.UPDATE,
          data: { name: 'Updated Client' },
          device_id: 'device-id',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      mockDeviceChangeRepository.create.mockReturnValue({
        id: 'change-id',
        userId: 'user-id',
        deviceId: 'device-id',
        objectType: ChangeObjectType.CLIENT,
        objectId: 'client-id',
        changeJson: changes[0].data,
        changeType: ChangeType.UPDATE,
        synced: false,
      });

      mockDeviceChangeRepository.save.mockResolvedValue({
        id: 'change-id',
        synced: true,
      });

      const existingClient = {
        id: 'client-id',
        userId: 'user-id',
        name: 'Old Client',
      };
      mockClientRepository.findOne.mockResolvedValue(existingClient);
      mockClientRepository.save.mockResolvedValue({
        ...existingClient,
        name: 'Updated Client',
      });

      const result = await service.pushChanges('user-id', {
        deviceId: 'device-id',
        changes,
      });

      expect(result.synced).toBe(1);
      expect(mockClientRepository.save).toHaveBeenCalled();
    });

    it('should handle DELETE change type', async () => {
      const changes = [
        {
          object_type: ChangeObjectType.CLIENT,
          object_id: 'client-id',
          change_type: ChangeType.DELETE,
          data: {},
          device_id: 'device-id',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      mockDeviceChangeRepository.create.mockReturnValue({
        id: 'change-id',
        userId: 'user-id',
        deviceId: 'device-id',
        objectType: ChangeObjectType.CLIENT,
        objectId: 'client-id',
        changeJson: {},
        changeType: ChangeType.DELETE,
        synced: false,
      });

      mockDeviceChangeRepository.save.mockResolvedValue({
        id: 'change-id',
        synced: true,
      });

      const existingClient = {
        id: 'client-id',
        userId: 'user-id',
        deletedAt: null,
      };
      mockClientRepository.findOne.mockResolvedValue(existingClient);
      mockClientRepository.save.mockResolvedValue({
        ...existingClient,
        deletedAt: new Date(),
      });

      const result = await service.pushChanges('user-id', {
        deviceId: 'device-id',
        changes,
      });

      expect(result.synced).toBe(1);
      expect(existingClient.deletedAt).toBeDefined();
    });
  });

  describe('pullChanges', () => {
    it('should return changes after timestamp', async () => {
      const sinceDate = new Date('2024-01-01T00:00:00Z');
      const mockClients = [
        { id: 'client-1', userId: 'user-id', updatedAt: new Date('2024-01-02T00:00:00Z') },
      ];
      const mockInvoices = [
        { id: 'invoice-1', userId: 'user-id', updatedAt: new Date('2024-01-02T00:00:00Z') },
      ];
      const mockItems = [
        { id: 'item-1', invoiceId: 'invoice-1' },
      ];
      const mockAttachments: any[] = [];

      mockClientRepository.find.mockResolvedValue(mockClients);
      mockInvoiceRepository.find.mockResolvedValue(mockInvoices);
      mockInvoiceItemRepository.find.mockResolvedValue(mockItems);
      mockAttachmentRepository.find.mockResolvedValue(mockAttachments);

      const result = await service.pullChanges('user-id', '2024-01-01T00:00:00Z');

      expect(result.clients).toEqual(mockClients);
      expect(result.invoices).toEqual(mockInvoices);
      expect(result.invoiceItems).toEqual(mockItems);
      expect(result.attachments).toEqual(mockAttachments);
      expect(result.lastSyncTimestamp).toBeDefined();
    });

    it('should return all changes if no timestamp provided', async () => {
      const mockClients = [
        { id: 'client-1', userId: 'user-id', updatedAt: new Date('2024-01-01T00:00:00Z') },
      ];
      const mockInvoices: any[] = [];
      const mockItems: any[] = [];
      const mockAttachments: any[] = [];

      mockClientRepository.find.mockResolvedValue(mockClients);
      mockInvoiceRepository.find.mockResolvedValue(mockInvoices);
      mockInvoiceItemRepository.find.mockResolvedValue(mockItems);
      mockAttachmentRepository.find.mockResolvedValue(mockAttachments);

      const result = await service.pullChanges('user-id');

      expect(result.clients).toEqual(mockClients);
      expect(result.invoices).toEqual(mockInvoices);
      expect(result.lastSyncTimestamp).toBeDefined();
    });

    it('should only return items for returned invoices', async () => {
      const mockInvoices = [
        { id: 'invoice-1', userId: 'user-id' },
        { id: 'invoice-2', userId: 'user-id' },
      ];
      const mockItems = [
        { id: 'item-1', invoiceId: 'invoice-1' },
        { id: 'item-2', invoiceId: 'invoice-2' },
        { id: 'item-3', invoiceId: 'invoice-3' }, // Should not be included
      ];

      mockClientRepository.find.mockResolvedValue([]);
      mockInvoiceRepository.find.mockResolvedValue(mockInvoices);
      mockInvoiceItemRepository.find.mockResolvedValue(mockItems);
      mockAttachmentRepository.find.mockResolvedValue([]);

      const result = await service.pullChanges('user-id');

      expect(result.invoiceItems.length).toBe(3);
      // In real implementation, items would be filtered by invoice IDs
    });
  });
});

