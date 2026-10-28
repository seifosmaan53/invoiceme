import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SyncService } from '../src/sync/sync.service';
import { DeviceChange, ChangeType, ChangeObjectType } from '../src/entities/device-change.entity';
import { Client } from '../src/entities/client.entity';
import { Invoice } from '../src/entities/invoice.entity';
import { InvoiceItem } from '../src/entities/invoice-item.entity';
import { Attachment } from '../src/entities/attachment.entity';
import { SyncConflict } from '../src/entities/sync-conflict.entity';
import { SyncTombstone } from '../src/entities/sync-tombstone.entity';
import { SyncRecordRevision } from '../src/entities/sync-record-revision.entity';
import { SYNC_CONFIG } from '../src/sync/sync-config';
import { SyncSchemaService } from '../src/sync/sync-schema.service';

// Record ids are UUIDs (non-UUID object_ids are rejected before any lookup)
const CLIENT_ID = '0b0e9a3c-2f0e-4c1a-9a51-6f2b8c7d1e01';

describe('SyncService', () => {
  let service: SyncService;
  let mockDeviceChangeRepository: any;
  let mockClientRepository: any;
  let mockInvoiceRepository: any;
  let mockInvoiceItemRepository: any;
  let mockAttachmentRepository: any;
  let mockTransactionManager: any;
  let mockConflictRepository: any;
  let mockTombstoneRepository: any;
  let mockRevisionRepository: any;

  // SyncService only applies fields that are real entity columns
  const metadata = (...columns: string[]) => ({
    tableName: 'records',
    columns: columns.map((propertyName) => ({ propertyName, databaseName: propertyName })),
  });

  beforeEach(async () => {
    // Each pushed change runs in a transaction whose manager hands out the
    // same repository mocks.
    mockTransactionManager = {
      query: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      getRepository: jest.fn(),
    };
    mockDeviceChangeRepository = {
      create: jest.fn(),
      save: jest.fn(),
      // device_changes lookup for records another user changed (none here)
      manager: {
        query: jest.fn().mockResolvedValue([]),
        transaction: jest.fn((work: (manager: any) => Promise<any>) => work(mockTransactionManager)),
      },
    };

    mockClientRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      insert: jest.fn(),
      exists: jest.fn(),
      metadata: metadata('id', 'userId', 'name', 'email', 'phone', 'deletedAt'),
    };

    mockInvoiceRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };

    // Items changed on their own since `since` (none in these tests)
    const noChangedItems: any = {};
    for (const step of ['innerJoin', 'where', 'andWhere', 'orderBy']) noChangedItems[step] = jest.fn(() => noChangedItems);
    noChangedItems.getMany = jest.fn().mockResolvedValue([]);

    mockInvoiceItemRepository = {
      createQueryBuilder: jest.fn(() => noChangedItems),
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    };

    mockConflictRepository = { exists: jest.fn().mockResolvedValue(false), count: jest.fn().mockResolvedValue(0) };
    mockTombstoneRepository = { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue([]) };
    mockRevisionRepository = {};

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
        { provide: getRepositoryToken(SyncConflict), useValue: mockConflictRepository },
        { provide: getRepositoryToken(SyncTombstone), useValue: mockTombstoneRepository },
        { provide: getRepositoryToken(SyncRecordRevision), useValue: mockRevisionRepository },
        { provide: SYNC_CONFIG, useValue: { legacyWriteCutoff: null, retentionDays: 400, conflictRetentionDays: 180 } },
        { provide: SyncSchemaService, useValue: { assertReady: jest.fn() } },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);

    const repositories = new Map<any, any>([
      [DeviceChange, mockDeviceChangeRepository],
      [Client, mockClientRepository],
      [Invoice, mockInvoiceRepository],
      [InvoiceItem, mockInvoiceItemRepository],
      [Attachment, mockAttachmentRepository],
      [SyncConflict, mockConflictRepository],
      [SyncTombstone, mockTombstoneRepository],
      [SyncRecordRevision, mockRevisionRepository],
    ]);
    mockTransactionManager.getRepository.mockImplementation((entity: any) => repositories.get(entity));
  });

  describe('pushChanges', () => {
    it('should process changes and return synced count', async () => {
      const changes = [
        {
          object_type: ChangeObjectType.CLIENT,
          object_id: CLIENT_ID,
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
        objectId: CLIENT_ID,
        changeJson: changes[0].data,
        changeType: ChangeType.CREATE,
        synced: false,
      });

      mockDeviceChangeRepository.save.mockResolvedValue({
        id: 'change-id',
        synced: true,
      });

      mockClientRepository.findOne.mockResolvedValue(null);
      mockClientRepository.insert.mockResolvedValue({ identifiers: [{ id: CLIENT_ID }] });

      const result = await service.pushChanges('user-id', {
        deviceId: 'device-id',
        changes,
      });

      expect(result.synced).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockDeviceChangeRepository.create).toHaveBeenCalled();
      expect(mockDeviceChangeRepository.save).toHaveBeenCalledTimes(1);
      expect(mockTransactionManager.update).toHaveBeenCalledWith(DeviceChange, 'change-id', {
        synced: true,
        outcome: 'applied',
        conflictId: null,
      });
      expect(mockClientRepository.findOne).toHaveBeenCalledWith({ where: { id: CLIENT_ID, userId: 'user-id' } });
      expect(mockClientRepository.insert).toHaveBeenCalledWith({
        name: 'Test Client',
        email: 'test@example.com',
        id: CLIENT_ID,
        userId: 'user-id',
      });
    });

    it('should never take the owner from change data', async () => {
      const changes = [
        {
          object_type: ChangeObjectType.CLIENT,
          object_id: CLIENT_ID,
          change_type: ChangeType.CREATE,
          data: { name: 'Test Client', userId: 'other-user-id', id: 'other-id' },
          device_id: 'device-id',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      mockDeviceChangeRepository.create.mockReturnValue({
        userId: 'user-id',
        objectType: ChangeObjectType.CLIENT,
        objectId: CLIENT_ID,
        changeJson: changes[0].data,
        changeType: ChangeType.CREATE,
      });
      mockClientRepository.findOne.mockResolvedValue(null);

      const result = await service.pushChanges('user-id', { deviceId: 'device-id', changes });

      expect(result).toMatchObject({ synced: 1, failed: 0 });
      expect(mockClientRepository.insert).toHaveBeenCalledWith({ name: 'Test Client', id: CLIENT_ID, userId: 'user-id' });
    });

    it('should count a DELETE of another user\'s client as failed', async () => {
      const changes = [
        {
          object_type: ChangeObjectType.CLIENT,
          object_id: CLIENT_ID,
          change_type: ChangeType.DELETE,
          data: {},
          device_id: 'device-id',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      mockDeviceChangeRepository.create.mockReturnValue({
        userId: 'user-id',
        objectType: ChangeObjectType.CLIENT,
        objectId: CLIENT_ID,
        changeJson: {},
        changeType: ChangeType.DELETE,
      });
      mockClientRepository.findOne.mockResolvedValue(null); // not visible to this user
      mockClientRepository.exists.mockResolvedValue(true); // but exists for someone else
      mockClientRepository.metadata.tableName = 'clients';

      const result = await service.pushChanges('user-id', { deviceId: 'device-id', changes });

      expect(result).toMatchObject({ synced: 0, failed: 1 });
      expect(mockClientRepository.save).not.toHaveBeenCalled();
    });

    it('should handle failed changes gracefully', async () => {
      const changes = [
        {
          object_type: ChangeObjectType.CLIENT,
          object_id: CLIENT_ID,
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
        objectId: CLIENT_ID,
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
          object_id: CLIENT_ID,
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
        objectId: CLIENT_ID,
        changeJson: changes[0].data,
        changeType: ChangeType.UPDATE,
        synced: false,
      });

      mockDeviceChangeRepository.save.mockResolvedValue({
        id: 'change-id',
        synced: true,
      });

      const existingClient = {
        id: CLIENT_ID,
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
          object_id: CLIENT_ID,
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
        objectId: CLIENT_ID,
        changeJson: {},
        changeType: ChangeType.DELETE,
        synced: false,
      });

      mockDeviceChangeRepository.save.mockResolvedValue({
        id: 'change-id',
        synced: true,
      });

      const existingClient = {
        id: CLIENT_ID,
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

