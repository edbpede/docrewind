/**
 * Shared type definitions for the DocRewind extension
 */

/**
 * Auth configuration
 */
export interface AuthConfig {
  clientId: string;
  scopes: string[];
  redirectUrl?: string;
}

/**
 * Auth token
 */
export interface AuthToken {
  access_token: string;
  refresh_token: string;
  expiry_time: number;
  token_type?: string;
  id_token?: string;
}

/**
 * User preferences
 */
export interface UserPreferences {
  playbackSpeed: number;
  autoPlay: boolean;
  theme: 'light' | 'dark' | 'system';
}

/**
 * Document metadata
 */
export interface DocumentMetadata {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  lastModifyingUser?: {
    displayName: string;
    emailAddress: string;
    photoLink?: string;
  };
}

/**
 * Document revision
 */
export interface DocumentRevision {
  id: string;
  timestamp: string;
  modifyingUser?: {
    displayName: string;
    emailAddress: string;
    photoLink?: string;
  };
}

/**
 * Document content
 */
export interface DocumentContent {
  documentId: string;
  revisionId: string;
  content: string;
}

/**
 * Playback state
 */
export enum PlaybackState {
  IDLE = 'idle',
  PLAYING = 'playing',
  PAUSED = 'paused',
  LOADING = 'loading',
  ERROR = 'error',
}

/**
 * Playback options
 */
export interface PlaybackOptions {
  speed: number;
  autoPlay: boolean;
}

/**
 * Error response from API
 */
export interface ErrorResponse {
  error: {
    code: number;
    message: string;
    status: string;
    details?: any[];
  };
}
