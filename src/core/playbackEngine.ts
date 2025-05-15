/**
 * Playback Engine module for DocRewind
 * Handles parsing and transformation of revision data and document playback
 */

import {
  CommandType,
  RevisionCommand,
  InsertCommand,
  DeleteCommand,
  StyleCommand,
  MultiCommand,
  RevisionData,
  PlaybackState,
  PlaybackOptions,
  DocumentCharacter
} from '@/core/types';
import logger from '@/utils/logger';

// Default playback options
const DEFAULT_PLAYBACK_OPTIONS: PlaybackOptions = {
  speed: 1.0,
  autoPlay: false
};

// Module name for logging
const MODULE_NAME = 'PlaybackEngine';

/**
 * Parse raw revision data from Google Docs API into a structured format
 * @param rawData - The raw revision data from the API
 * @returns Structured revision data with commands
 */
export const parseRevisionData = (rawData: any): RevisionData => {
  try {
    const { revisionId, timestamp, changelog } = rawData;
    const commands: RevisionCommand[] = [];

    // Process each change in the changelog
    if (changelog && changelog.changes) {
      for (const change of changelog.changes) {
        const command = parseCommand(change);
        if (command) {
          commands.push(command);
        }
      }
    }

    logger.info(MODULE_NAME, `Parsed revision data: ${revisionId} with ${commands.length} commands`);

    return {
      revisionId,
      timestamp,
      commands
    };
  } catch (error) {
    logger.error(MODULE_NAME, 'Error parsing revision data', error);
    throw new Error(`Failed to parse revision data: ${error}`);
  }
};

/**
 * Parse a single command from the raw change data
 * @param change - The raw change data
 * @returns A structured command object
 */
const parseCommand = (change: any): RevisionCommand | null => {
  const { ty, ts: timestamp } = change;

  switch (ty) {
    case 'is': // Insert
      return {
        ty: CommandType.INSERT,
        ibi: change.ibi,
        s: change.s,
        timestamp
      } as InsertCommand;

    case 'ds': // Delete
      return {
        ty: CommandType.DELETE,
        si: change.si,
        ei: change.ei,
        timestamp
      } as DeleteCommand;

    case 'st': // Style
      return {
        ty: CommandType.STYLE,
        si: change.si,
        ei: change.ei,
        s: change.s,
        timestamp
      } as StyleCommand;

    case 'mlti': // Multi command
      const cmds = change.cmds.map((cmd: any) => parseCommand(cmd)).filter(Boolean);
      return {
        ty: CommandType.MULTI,
        cmds,
        timestamp
      } as MultiCommand;

    default:
      logger.warn(MODULE_NAME, `Unknown command type: ${ty}`);
      return null;
  }
};

/**
 * Apply a series of commands to a document to transform it
 * @param document - The current document content
 * @param commands - The commands to apply
 * @returns The transformed document content
 */
export const applyCommandsToDocument = (document: string, commands: RevisionCommand[]): string => {
  let result = document;

  for (const command of commands) {
    result = applyCommand(result, command);
  }

  return result;
};

/**
 * Apply a single command to a document
 * @param document - The current document content
 * @param command - The command to apply
 * @returns The transformed document content
 */
const applyCommand = (document: string, command: RevisionCommand): string => {
  switch (command.ty) {
    case CommandType.INSERT:
      return applyInsertCommand(document, command);

    case CommandType.DELETE:
      return applyDeleteCommand(document, command);

    case CommandType.STYLE:
      // Style commands don't change the text content, only the styling
      // In a real implementation, we would need to track styling separately
      return document;

    case CommandType.MULTI:
      return applyMultiCommand(document, command);

    default:
      logger.warn(MODULE_NAME, `Unknown command type: ${command.ty}`);
      return document;
  }
};

/**
 * Apply an insert command to a document
 * @param document - The current document content
 * @param command - The insert command to apply
 * @returns The transformed document content
 */
const applyInsertCommand = (document: string, command: InsertCommand): string => {
  const { ibi, s } = command;
  return document.slice(0, ibi) + s + document.slice(ibi);
};

/**
 * Apply a delete command to a document
 * @param document - The current document content
 * @param command - The delete command to apply
 * @returns The transformed document content
 */
const applyDeleteCommand = (document: string, command: DeleteCommand): string => {
  const { si, ei } = command;
  return document.slice(0, si) + document.slice(ei);
};

/**
 * Apply a multi command to a document
 * @param document - The current document content
 * @param command - The multi command to apply
 * @returns The transformed document content
 */
const applyMultiCommand = (document: string, command: MultiCommand): string => {
  let result = document;

  for (const cmd of command.cmds) {
    result = applyCommand(result, cmd);
  }

  return result;
};

/**
 * Create a detailed document representation with character-level metadata
 * @param document - The document content
 * @param commands - The commands that were applied to create this document
 * @returns An array of characters with metadata
 */
export const createDetailedDocument = (document: string, commands: RevisionCommand[]): DocumentCharacter[] => {
  // Initialize all characters with default values
  const detailedDocument: DocumentCharacter[] = document.split('').map(char => ({
    char,
    timestamp: 0,
    styles: {}
  }));

  // Apply each command to update the metadata
  for (const command of commands) {
    applyCommandToDetailedDocument(detailedDocument, command);
  }

  return detailedDocument;
};

/**
 * Apply a command to update the detailed document metadata
 * @param detailedDocument - The detailed document representation
 * @param command - The command to apply
 */
const applyCommandToDetailedDocument = (detailedDocument: DocumentCharacter[], command: RevisionCommand): void => {
  switch (command.ty) {
    case CommandType.INSERT:
      // For insert commands, we would update the timestamp of the inserted characters
      // This is a simplified implementation
      break;

    case CommandType.STYLE:
      // For style commands, we would update the styles of the affected characters
      const { si, ei, s } = command as StyleCommand;
      for (let i = si; i < ei && i < detailedDocument.length; i++) {
        detailedDocument[i].styles = { ...detailedDocument[i].styles, ...s };
      }
      break;

    case CommandType.MULTI:
      // For multi commands, apply each sub-command
      const { cmds } = command as MultiCommand;
      for (const cmd of cmds) {
        applyCommandToDetailedDocument(detailedDocument, cmd);
      }
      break;

    default:
      break;
  }
};

/**
 * PlaybackEngine class for managing document state and playback
 * Handles stepping through revisions, playing/pausing, and reconstructing document state
 */
export class PlaybackEngine {
  private revisions: RevisionData[];
  private currentRevisionIndex: number;
  private currentContent: string;
  private state: PlaybackState;
  private options: PlaybackOptions;
  private playbackInterval: number | null;

  /**
   * Create a new PlaybackEngine instance
   * @param revisions - The revision data to use for playback
   * @param options - Optional playback options
   */
  constructor(revisions: RevisionData[], options: Partial<PlaybackOptions> = {}) {
    this.revisions = revisions;
    this.currentRevisionIndex = -1; // Start before the first revision
    this.currentContent = '';
    this.state = PlaybackState.IDLE;
    this.options = { ...DEFAULT_PLAYBACK_OPTIONS, ...options };
    this.playbackInterval = null;

    logger.info(MODULE_NAME, `PlaybackEngine initialized with ${revisions.length} revisions`);
  }

  /**
   * Get the current playback state
   * @returns The current playback state
   */
  public getState(): PlaybackState {
    return this.state;
  }

  /**
   * Get the current revision index
   * @returns The current revision index (-1 if at initial state)
   */
  public getCurrentRevisionIndex(): number {
    return this.currentRevisionIndex;
  }

  /**
   * Get the current document content
   * @returns The current document content
   */
  public getCurrentContent(): string {
    return this.currentContent;
  }

  /**
   * Get the current playback options
   * @returns The current playback options
   */
  public getOptions(): PlaybackOptions {
    return { ...this.options };
  }

  /**
   * Set playback options
   * @param options - The new playback options
   */
  public setOptions(options: Partial<PlaybackOptions>): void {
    this.options = { ...this.options, ...options };
    logger.info(MODULE_NAME, `Playback options updated: ${JSON.stringify(this.options)}`);
  }

  /**
   * Step forward to the next revision
   * @returns True if stepped forward, false if already at the end
   */
  public stepForward(): boolean {
    if (this.currentRevisionIndex >= this.revisions.length - 1) {
      logger.info(MODULE_NAME, 'Already at the last revision');
      return false;
    }

    this.currentRevisionIndex++;
    this.reconstructCurrentContent();
    logger.info(MODULE_NAME, `Stepped forward to revision ${this.currentRevisionIndex}`);
    return true;
  }

  /**
   * Step backward to the previous revision
   * @returns True if stepped backward, false if already at the beginning
   */
  public stepBackward(): boolean {
    if (this.currentRevisionIndex <= -1) {
      logger.info(MODULE_NAME, 'Already at the initial state');
      return false;
    }

    this.currentRevisionIndex--;
    this.reconstructCurrentContent();
    logger.info(MODULE_NAME, `Stepped backward to revision ${this.currentRevisionIndex}`);
    return true;
  }

  /**
   * Jump to a specific revision
   * @param index - The revision index to jump to
   * @returns True if jumped successfully
   */
  public jumpToRevision(index: number): boolean {
    if (index < -1) {
      // Can't go before initial state
      this.currentRevisionIndex = -1;
      this.currentContent = '';
      logger.info(MODULE_NAME, 'Jumped to initial state');
      return true;
    }

    if (index >= this.revisions.length) {
      // Can't go beyond the last revision
      this.currentRevisionIndex = this.revisions.length - 1;
      this.reconstructCurrentContent();
      logger.info(MODULE_NAME, `Jumped to last revision ${this.currentRevisionIndex}`);
      return true;
    }

    this.currentRevisionIndex = index;
    this.reconstructCurrentContent();
    logger.info(MODULE_NAME, `Jumped to revision ${this.currentRevisionIndex}`);
    return true;
  }

  /**
   * Start playback from the current position
   * @returns True if playback started
   */
  public play(): boolean {
    if (this.state === PlaybackState.PLAYING) {
      logger.info(MODULE_NAME, 'Already playing');
      return false;
    }

    this.state = PlaybackState.PLAYING;
    logger.info(MODULE_NAME, 'Playback started');

    // Calculate interval based on speed
    const interval = 100 / this.options.speed;

    // Clear any existing interval
    if (this.playbackInterval !== null) {
      window.clearInterval(this.playbackInterval);
    }

    // Start playback interval
    this.playbackInterval = window.setInterval(() => {
      const hasMoreRevisions = this.stepForward();
      if (!hasMoreRevisions) {
        this.pause();
        this.state = PlaybackState.IDLE;
        logger.info(MODULE_NAME, 'Playback completed');
      }
    }, interval);

    return true;
  }

  /**
   * Pause playback
   * @returns True if paused successfully
   */
  public pause(): boolean {
    if (this.state !== PlaybackState.PLAYING) {
      logger.info(MODULE_NAME, 'Not currently playing');
      return false;
    }

    if (this.playbackInterval !== null) {
      window.clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }

    this.state = PlaybackState.PAUSED;
    logger.info(MODULE_NAME, 'Playback paused');
    return true;
  }

  /**
   * Reset playback to the initial state
   */
  public reset(): void {
    this.pause();
    this.currentRevisionIndex = -1;
    this.currentContent = '';
    this.state = PlaybackState.IDLE;
    logger.info(MODULE_NAME, 'Playback reset to initial state');
  }

  /**
   * Reconstruct the document content at the current revision index
   * @private
   */
  private reconstructCurrentContent(): void {
    if (this.currentRevisionIndex === -1) {
      // Initial state is an empty document
      this.currentContent = '';
      return;
    }

    // Start with an empty document
    let content = '';

    // Apply all commands up to the current revision
    for (let i = 0; i <= this.currentRevisionIndex; i++) {
      const revision = this.revisions[i];
      content = applyCommandsToDocument(content, revision.commands);
    }

    this.currentContent = content;
  }
}
