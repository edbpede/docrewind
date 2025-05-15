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
