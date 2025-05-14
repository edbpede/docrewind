/**
 * Data Fetcher module for Google Docs
 * Handles fetching document metadata, revision history, and detailed edit data
 */

import { getAuthToken } from '@/core/auth';
import { API, ERRORS } from '@/utils/constants';
import logger from '@/utils/logger';
import { DocumentMetadata, DocumentRevision, ErrorResponse } from '@/core/types';

// Module name for logging
const MODULE_NAME = 'DataFetcher';

/**
 * Extract document ID from a Google Docs URL or return the ID if already provided
 * @param urlOrId - Google Docs URL or document ID
 * @returns The document ID
 * @throws Error if the URL is invalid
 */
export const extractDocumentId = (urlOrId: string): string => {
  try {
    // Check if it's already a document ID (simple validation)
    if (/^[a-zA-Z0-9_-]+$/.test(urlOrId)) {
      return urlOrId;
    }

    // Try to extract from URL
    const match = urlOrId.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }

    throw new Error(ERRORS.INVALID_DOCUMENT_URL);
  } catch (error) {
    logger.error(MODULE_NAME, ERRORS.INVALID_DOCUMENT_URL, error);
    throw new Error(ERRORS.INVALID_DOCUMENT_URL);
  }
};

/**
 * Get document metadata from Google Drive API
 * @param documentId - The document ID
 * @returns A promise that resolves with the document metadata
 * @throws Error if authentication fails or the API request fails
 */
export const getDocumentMetadata = async (documentId: string): Promise<DocumentMetadata> => {
  try {
    const token = await getAuthToken();
    if (!token) {
      throw new Error(ERRORS.NO_AUTH_TOKEN);
    }

    // Fields to request from the API
    const fields = 'id,name,mimeType,createdTime,modifiedTime,lastModifyingUser';
    
    // Make the API request
    const response = await fetch(`${API.DRIVE_API}/files/${documentId}?fields=${fields}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json() as ErrorResponse;
      throw new Error(`${response.status} ${response.statusText}: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    
    // Transform the response to our internal format
    const metadata: DocumentMetadata = {
      id: data.id,
      name: data.name,
      mimeType: data.mimeType,
      createdTime: data.createdTime,
      modifiedTime: data.modifiedTime,
      lastModifyingUser: data.lastModifyingUser ? {
        displayName: data.lastModifyingUser.displayName,
        emailAddress: data.lastModifyingUser.emailAddress,
        photoLink: data.lastModifyingUser.photoLink
      } : undefined
    };

    logger.info(MODULE_NAME, `Retrieved metadata for document: ${documentId}`);
    return metadata;
  } catch (error) {
    logger.error(MODULE_NAME, `Failed to get document metadata: ${documentId}`, error);
    throw error;
  }
};

/**
 * Get revision list for a document from Google Drive API
 * @param documentId - The document ID
 * @returns A promise that resolves with the list of revisions
 * @throws Error if authentication fails or the API request fails
 */
export const getRevisionList = async (documentId: string): Promise<DocumentRevision[]> => {
  try {
    const token = await getAuthToken();
    if (!token) {
      throw new Error(ERRORS.NO_AUTH_TOKEN);
    }

    // Fields to request from the API
    const fields = 'revisions(id,modifiedTime,modifyingUser)';
    
    // Make the API request
    const response = await fetch(`${API.DRIVE_API}/files/${documentId}/revisions?fields=${fields}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json() as ErrorResponse;
      throw new Error(`${response.status} ${response.statusText}: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    
    // Transform the response to our internal format
    const revisions: DocumentRevision[] = data.revisions ? data.revisions.map((rev: any) => ({
      id: rev.id,
      timestamp: rev.modifiedTime,
      modifyingUser: rev.modifyingUser ? {
        displayName: rev.modifyingUser.displayName,
        emailAddress: rev.modifyingUser.emailAddress,
        photoLink: rev.modifyingUser.photoLink
      } : undefined
    })) : [];

    logger.info(MODULE_NAME, `Retrieved ${revisions.length} revisions for document: ${documentId}`);
    return revisions;
  } catch (error) {
    logger.error(MODULE_NAME, `Failed to get revision list: ${documentId}`, error);
    throw error;
  }
};

/**
 * Get detailed revision data using the undocumented Google Docs revision API
 * @param documentId - The document ID
 * @param start - The start revision index
 * @param end - The end revision index
 * @returns A promise that resolves with the detailed revision data
 * @throws Error if authentication fails or the API request fails
 */
export const getRevisionData = async (documentId: string, start: number, end: number): Promise<any> => {
  try {
    const token = await getAuthToken();
    if (!token) {
      throw new Error(ERRORS.NO_AUTH_TOKEN);
    }

    // This is using an undocumented API endpoint that Google Docs uses internally
    const url = `https://docs.google.com/document/d/${documentId}/revisions/load?id=${documentId}&start=${start}&end=${end}`;
    
    // Make the API request
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    // Google often prefixes JSON responses with ")]}'\n" to prevent JSON hijacking
    const text = await response.text();
    const jsonText = text.replace(/^\)\]\}\'\\n/, '');
    const data = JSON.parse(jsonText);

    logger.info(MODULE_NAME, `Retrieved revision data for document: ${documentId} (${start}-${end})`);
    return data;
  } catch (error) {
    logger.error(MODULE_NAME, `Failed to get revision data: ${documentId} (${start}-${end})`, error);
    throw error;
  }
};

/**
 * Fetch the current content of a document using the Google Docs API
 * @param documentId - The document ID
 * @returns A promise that resolves with the document content
 * @throws Error if authentication fails or the API request fails
 */
export const fetchDocumentContent = async (documentId: string): Promise<any> => {
  try {
    const token = await getAuthToken();
    if (!token) {
      throw new Error(ERRORS.NO_AUTH_TOKEN);
    }
    
    // Make the API request
    const response = await fetch(`${API.DOCS_API}/${documentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json() as ErrorResponse;
      throw new Error(`${response.status} ${response.statusText}: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    
    logger.info(MODULE_NAME, `Retrieved content for document: ${documentId}`);
    return data;
  } catch (error) {
    logger.error(MODULE_NAME, `Failed to get document content: ${documentId}`, error);
    throw error;
  }
};

/**
 * Find the maximum revision index for a document
 * This uses binary search to efficiently find the upper bound
 * @param documentId - The document ID
 * @returns A promise that resolves with the maximum revision index
 */
export const findMaxRevisionIndex = async (documentId: string): Promise<number> => {
  try {
    const token = await getAuthToken();
    if (!token) {
      throw new Error(ERRORS.NO_AUTH_TOKEN);
    }

    // Start with a reasonable guess
    let low = 1;
    let high = 1000;
    let found = false;

    // First, try to quickly find an upper bound
    while (!found) {
      try {
        await getRevisionData(documentId, high, high);
        // If successful, double the high value
        low = high;
        high = high * 2;
      } catch (error) {
        // We've gone too high, start binary search
        found = true;
      }
    }

    // Binary search to find the exact maximum
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      
      try {
        await getRevisionData(documentId, mid, mid);
        // If successful, try higher
        low = mid + 1;
      } catch (error) {
        // If failed, try lower
        high = mid - 1;
      }
    }

    // The result is high (the last successful index)
    logger.info(MODULE_NAME, `Found maximum revision index for document: ${documentId} = ${high}`);
    return high;
  } catch (error) {
    logger.error(MODULE_NAME, `Failed to find max revision index: ${documentId}`, error);
    throw error;
  }
};

/**
 * Get all revision data for a document
 * This fetches data in chunks to avoid hitting API limits
 * @param documentId - The document ID
 * @param chunkSize - The number of revisions to fetch in each chunk
 * @returns A promise that resolves with all revision data
 */
export const getAllRevisionData = async (documentId: string, chunkSize = 50): Promise<any[]> => {
  try {
    const maxIndex = await findMaxRevisionIndex(documentId);
    const allData: any[] = [];
    
    // Fetch in chunks
    for (let start = 1; start <= maxIndex; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, maxIndex);
      const data = await getRevisionData(documentId, start, end);
      allData.push(data);
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.info(MODULE_NAME, `Retrieved all revision data for document: ${documentId}`);
    return allData;
  } catch (error) {
    logger.error(MODULE_NAME, `Failed to get all revision data: ${documentId}`, error);
    throw error;
  }
};
