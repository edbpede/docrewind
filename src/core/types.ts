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

/**
 * Revision command types
 */
export enum CommandType {
  INSERT = 'is',
  DELETE = 'ds',
  MULTI = 'mlti',
  STYLE = 'st',
}

/**
 * Base revision command interface
 */
export interface BaseCommand {
  ty: CommandType;
  timestamp: number;
}

/**
 * Insert command
 */
export interface InsertCommand extends BaseCommand {
  ty: CommandType.INSERT;
  ibi: number; // Insert begin index
  s: string;   // String to insert
}

/**
 * Delete command
 */
export interface DeleteCommand extends BaseCommand {
  ty: CommandType.DELETE;
  si: number;  // Start index
  ei: number;  // End index
}

/**
 * Style command
 */
export interface StyleCommand extends BaseCommand {
  ty: CommandType.STYLE;
  si: number;  // Start index
  ei: number;  // End index
  s: {         // Style properties
    [key: string]: any;
  };
}

/**
 * Multi command (contains multiple commands)
 */
export interface MultiCommand extends BaseCommand {
  ty: CommandType.MULTI;
  cmds: (InsertCommand | DeleteCommand | StyleCommand)[];
}

/**
 * Union type for all command types
 */
export type RevisionCommand = InsertCommand | DeleteCommand | StyleCommand | MultiCommand;

/**
 * Detailed revision data
 */
export interface RevisionData {
  revisionId: string;
  timestamp: number;
  commands: RevisionCommand[];
  snapshot?: string;
}

/**
 * Character in document with its properties
 */
export interface DocumentCharacter {
  char: string;
  styles?: {
    [key: string]: any;
  };
  timestamp: number;
  authorId?: string;
}
