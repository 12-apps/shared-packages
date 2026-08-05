import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Database } from '../../src/db/lib/database';
import type { DatabaseConfig } from '../../src/db/lib/types';

// Mock the logger to suppress error logs during tests
vi.mock('../../src/db/lib/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  createQueryProfiler: () => vi.fn(),
  setLogger: vi.fn(),
}));

// Create mock objects at module level so they can be accessed in tests
const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockRelease = vi.fn();

const mockClient = {
  query: vi.fn(),
  release: mockRelease,
};

const mockPool = {
  query: mockQuery,
  connect: mockConnect,
  end: mockEnd,
  totalCount: 10,
  idleCount: 5,
  waitingCount: 0,
};

// Mock pg module
vi.mock('pg', () => {
  const Pool = vi.fn(() => mockPool);

  return {
    default: { Pool },
    Pool,
  };
});

describe('Database', () => {
  const config: DatabaseConfig = {
    user: 'testuser',
    password: 'testpass',
    host: 'localhost',
    database: 'testdb',
    port: 5432,
  };

  let getDbConfig = () => ({});

  // The queries below are arguments to a mocked pool, never sent anywhere; they
  // are named so the assertion and the call cannot drift apart.
  const insertSql = 'INSERT INTO users VALUES (1)';

  // Each test builds its own instance: a Database opened in one test must not be
  // visible to the next, or an `end()` in one leaks into another's assertions.
  const makeDatabase = () => new Database(getDbConfig);

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    mockConnect.mockResolvedValue(mockClient);
    getDbConfig = () => ({ ...config });
  });

  describe('constructor', () => {
    it('should create a new database instance with provided config', () => {
      const database = makeDatabase();
      // Trigger lazy initialization by accessing connection count
      database.getConnectionCount();

      expect(database.config).toEqual(config);
      expect(database.pool).toBeDefined();
    });

    it('should throw error if required config fields are missing', () => {
      const invalidDb = new Database(() => ({ user: 'test' } as DatabaseConfig));
      // Trigger lazy initialization which should throw
      expect(() => invalidDb.getConnectionCount()).toThrow('Database configuration missing required fields');
    });
  });

  describe('query', () => {
    it('should execute query without parameters', async () => {
      const database = makeDatabase();
      const mockResult = { rows: [{ id: 1 }], rowCount: 1 };
      mockPool.query.mockResolvedValue(mockResult);

      const sql = 'SELECT * FROM users';
      const result = await database.query(sql);

      expect(mockPool.query).toHaveBeenCalledWith(sql);
      expect(result).toEqual(mockResult);
    });

    it('should execute query with parameters', async () => {
      const database = makeDatabase();
      const mockResult = { rows: [{ id: 1, name: 'John' }], rowCount: 1 };
      mockPool.query.mockResolvedValue(mockResult);

      const sql = 'SELECT * FROM users WHERE id = $1';
      const result = await database.query(sql, [1]);

      expect(mockPool.query).toHaveBeenCalledWith(sql, [1]);
      expect(result).toEqual(mockResult);
    });

    it('should handle query errors', async () => {
      const database = makeDatabase();
      const error = new Error('Database error');
      mockPool.query.mockRejectedValue(error);

      await expect(database.query('INVALID SQL')).rejects.toThrow('Database error');
    });

    it('should skip logging when skipLogging option is true', async () => {
      const dbWithLogging = new Database(() => ({
        ...config,
        enableLogging: true,
        logQuery: vi.fn(),
      } as DatabaseConfig));

      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const sql = 'SELECT 1';
      await dbWithLogging.query(sql, [], { skipLogging: true });

      expect(dbWithLogging.config.logQuery).not.toHaveBeenCalled();
    });
  });

  describe('bulkInsert', () => {
    it('should insert rows in chunks', async () => {
      const database = makeDatabase();
      mockPool.query.mockResolvedValue({ rowCount: 2 });

      const rows = [
        [1, 'Alice'],
        [2, 'Bob'],
        [3, 'Charlie'],
      ];

      await database.bulkInsert('users', ['id', 'name'], rows, { chunkSize: 2 });

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenNthCalledWith(
        1,
        'INSERT INTO users (id, name) VALUES ($1, $2), ($3, $4)',
        [1, 'Alice', 2, 'Bob'],
      );
      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        'INSERT INTO users (id, name) VALUES ($1, $2)',
        [3, 'Charlie'],
      );
    });

    it('should call progress callback', async () => {
      const database = makeDatabase();
      mockPool.query.mockResolvedValue({ rowCount: 2 });
      const onProgress = vi.fn();

      const rows = [[1, 'Alice'], [2, 'Bob']];
      await database.bulkInsert('users', ['id', 'name'], rows, {
        chunkSize: 1,
        onProgress,
      });

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(1, 2);
      expect(onProgress).toHaveBeenCalledWith(2, 2);
    });

    it('should handle empty rows', async () => {
      const database = makeDatabase();
      await database.bulkInsert('users', ['id', 'name'], []);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('transaction', () => {
    it('should commit transaction on success', async () => {
      const database = makeDatabase();
      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };
      mockPool.connect.mockResolvedValue(mockClient);

      const result = await database.transaction(async (client) => {
        await client.query(insertSql);
        return 'success';
      });

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('INSERT INTO users VALUES (1)');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
      expect(result).toBe('success');
    });

    it('should rollback transaction on error', async () => {
      const database = makeDatabase();
      const mockClient = {
        query: vi.fn().mockImplementation((query) => {
          if (query === 'INSERT INTO users VALUES (1)') {
            throw new Error('Insert failed');
          }
        }),
        release: vi.fn(),
      };
      mockPool.connect.mockResolvedValue(mockClient);

      await expect(
        database.transaction(async (client) => {
          await client.query(insertSql);
        }),
      ).rejects.toThrow('Insert failed');

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('connection management', () => {
    it('should return connection counts', () => {
      const database = makeDatabase();
      expect(database.getConnectionCount()).toBe(10);
      expect(database.getIdleConnectionCount()).toBe(5);
      expect(database.getWaitingCount()).toBe(0);
    });

    it('should end pool connection', async () => {
      const database = makeDatabase();
      await database.end();
      expect(mockPool.end).toHaveBeenCalled();
    });
  });
});
