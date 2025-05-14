import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getDocumentMetadata,
  getRevisionList,
  getRevisionData,
  fetchDocumentContent,
  extractDocumentId
} from '@/core/dataFetcher';
import { getAuthToken } from '@/core/auth';
import { API, ERRORS } from '@/utils/constants';

// Mock the auth module
vi.mock('@/core/auth', () => ({
  getAuthToken: vi.fn()
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Data Fetcher Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();
    
    // Setup default auth token mock
    (getAuthToken as any).mockResolvedValue({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expiry_time: Date.now() + 3600000 // 1 hour in the future
    });
  });

  afterEach(() => {
    // Clear mocks after each test
    vi.clearAllMocks();
  });

  describe('extractDocumentId', () => {
    it('should extract document ID from a Google Docs URL', () => {
      const url = 'https://docs.google.com/document/d/1abc123def456/edit';
      const result = extractDocumentId(url);
      expect(result).toBe('1abc123def456');
    });

    it('should extract document ID from a Google Docs URL with additional parameters', () => {
      const url = 'https://docs.google.com/document/d/1abc123def456/edit?usp=sharing';
      const result = extractDocumentId(url);
      expect(result).toBe('1abc123def456');
    });

    it('should return the ID directly if it appears to be a document ID', () => {
      const id = '1abc123def456';
      const result = extractDocumentId(id);
      expect(result).toBe('1abc123def456');
    });

    it('should throw an error for invalid URLs', () => {
      const url = 'https://example.com/not-a-google-doc';
      expect(() => extractDocumentId(url)).toThrow(ERRORS.INVALID_DOCUMENT_URL);
    });
  });

  describe('getDocumentMetadata', () => {
    it('should fetch document metadata successfully', async () => {
      // Mock successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          id: 'test-doc-id',
          name: 'Test Document',
          mimeType: 'application/vnd.google-apps.document',
          createdTime: '2023-01-01T00:00:00.000Z',
          modifiedTime: '2023-01-02T00:00:00.000Z',
          lastModifyingUser: {
            displayName: 'Test User',
            emailAddress: 'test@example.com'
          }
        })
      });

      const result = await getDocumentMetadata('test-doc-id');

      expect(mockFetch).toHaveBeenCalledWith(
        `${API.DRIVE_API}/files/test-doc-id?fields=id,name,mimeType,createdTime,modifiedTime,lastModifyingUser`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-access-token'
          })
        })
      );

      expect(result).toEqual({
        id: 'test-doc-id',
        name: 'Test Document',
        mimeType: 'application/vnd.google-apps.document',
        createdTime: '2023-01-01T00:00:00.000Z',
        modifiedTime: '2023-01-02T00:00:00.000Z',
        lastModifyingUser: {
          displayName: 'Test User',
          emailAddress: 'test@example.com',
          photoLink: undefined
        }
      });
    });

    it('should handle authentication errors', async () => {
      // Mock auth error
      (getAuthToken as any).mockResolvedValueOnce(null);

      await expect(getDocumentMetadata('test-doc-id')).rejects.toThrow(ERRORS.NO_AUTH_TOKEN);
    });

    it('should handle API errors', async () => {
      // Mock API error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValueOnce({
          error: {
            code: 404,
            message: 'File not found'
          }
        })
      });

      await expect(getDocumentMetadata('test-doc-id')).rejects.toThrow(/404 Not Found/);
    });
  });

  describe('getRevisionList', () => {
    it('should fetch revision list successfully', async () => {
      // Mock successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          revisions: [
            {
              id: 'rev-1',
              modifiedTime: '2023-01-01T01:00:00.000Z',
              modifyingUser: {
                displayName: 'Test User',
                emailAddress: 'test@example.com'
              }
            },
            {
              id: 'rev-2',
              modifiedTime: '2023-01-01T02:00:00.000Z',
              modifyingUser: {
                displayName: 'Test User',
                emailAddress: 'test@example.com'
              }
            }
          ]
        })
      });

      const result = await getRevisionList('test-doc-id');

      expect(mockFetch).toHaveBeenCalledWith(
        `${API.DRIVE_API}/files/test-doc-id/revisions?fields=revisions(id,modifiedTime,modifyingUser)`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-access-token'
          })
        })
      );

      expect(result).toEqual([
        {
          id: 'rev-1',
          timestamp: '2023-01-01T01:00:00.000Z',
          modifyingUser: {
            displayName: 'Test User',
            emailAddress: 'test@example.com',
            photoLink: undefined
          }
        },
        {
          id: 'rev-2',
          timestamp: '2023-01-01T02:00:00.000Z',
          modifyingUser: {
            displayName: 'Test User',
            emailAddress: 'test@example.com',
            photoLink: undefined
          }
        }
      ]);
    });

    it('should handle empty revision list', async () => {
      // Mock empty response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          revisions: []
        })
      });

      const result = await getRevisionList('test-doc-id');
      expect(result).toEqual([]);
    });
  });

  describe('getRevisionData', () => {
    it('should fetch revision data successfully', async () => {
      // Mock successful response for the undocumented API
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValueOnce(
          ")]}'\\n" + // This is the typical prefix Google uses for JSON responses
          JSON.stringify({
            // Simplified mock of the revision data structure
            changelog: {
              // Changelog data would be here
            },
            chunkedSnapshot: {
              // Snapshot data would be here
            },
            revisionId: 'rev-1',
            timestamp: 1672531200000 // 2023-01-01T01:00:00.000Z
          })
        )
      });

      const result = await getRevisionData('test-doc-id', 1, 10);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://docs.google.com/document/d/test-doc-id/revisions/load?id=test-doc-id&start=1&end=10`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-access-token'
          })
        })
      );

      expect(result).toHaveProperty('revisionId');
      expect(result).toHaveProperty('timestamp');
    });

    it('should handle errors in revision data fetching', async () => {
      // Mock error response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      await expect(getRevisionData('test-doc-id', 1, 10)).rejects.toThrow(/403 Forbidden/);
    });
  });

  describe('fetchDocumentContent', () => {
    it('should fetch document content successfully', async () => {
      // Mock successful response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          body: {
            content: [
              // Document content would be here
            ]
          }
        })
      });

      const result = await fetchDocumentContent('test-doc-id');

      expect(mockFetch).toHaveBeenCalledWith(
        `${API.DOCS_API}/test-doc-id`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-access-token'
          })
        })
      );

      expect(result).toHaveProperty('body');
    });

    it('should handle errors in document content fetching', async () => {
      // Mock error response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValueOnce({
          error: {
            code: 404,
            message: 'Document not found'
          }
        })
      });

      await expect(fetchDocumentContent('test-doc-id')).rejects.toThrow(/404 Not Found/);
    });
  });
});
