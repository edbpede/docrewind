import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRevisionData, applyCommandsToDocument } from '@/core/playbackEngine';
import { CommandType, InsertCommand, DeleteCommand, StyleCommand, MultiCommand, RevisionCommand } from '@/core/types';

describe('Playback Engine - Data Parsing', () => {
  describe('parseRevisionData', () => {
    it('should parse raw revision data into structured format', () => {
      // Mock raw revision data from Google Docs API
      const mockRawData = {
        changelog: {
          // This structure is based on observed Google Docs API responses
          // The actual structure might vary
          changes: [
            {
              ty: 'is', // insert
              ibi: 0,   // insert begin index
              s: 'Hello',  // string to insert
              ts: 1672531200000, // timestamp
            },
            {
              ty: 'is',
              ibi: 5,
              s: ' world',
              ts: 1672531210000,
            }
          ]
        },
        revisionId: 'rev-1',
        timestamp: 1672531200000 // 2023-01-01T01:00:00.000Z
      };

      const result = parseRevisionData(mockRawData);

      expect(result).toEqual({
        revisionId: 'rev-1',
        timestamp: 1672531200000,
        commands: [
          {
            ty: CommandType.INSERT,
            ibi: 0,
            s: 'Hello',
            timestamp: 1672531200000
          },
          {
            ty: CommandType.INSERT,
            ibi: 5,
            s: ' world',
            timestamp: 1672531210000
          }
        ]
      });
    });

    it('should handle delete commands', () => {
      const mockRawData = {
        changelog: {
          changes: [
            {
              ty: 'ds', // delete
              si: 6,    // start index
              ei: 11,   // end index
              ts: 1672531220000,
            }
          ]
        },
        revisionId: 'rev-2',
        timestamp: 1672531220000
      };

      const result = parseRevisionData(mockRawData);

      expect(result).toEqual({
        revisionId: 'rev-2',
        timestamp: 1672531220000,
        commands: [
          {
            ty: CommandType.DELETE,
            si: 6,
            ei: 11,
            timestamp: 1672531220000
          }
        ]
      });
    });

    it('should handle style commands', () => {
      const mockRawData = {
        changelog: {
          changes: [
            {
              ty: 'st', // style
              si: 0,    // start index
              ei: 5,    // end index
              s: {      // style properties
                bold: true,
                italic: false
              },
              ts: 1672531230000,
            }
          ]
        },
        revisionId: 'rev-3',
        timestamp: 1672531230000
      };

      const result = parseRevisionData(mockRawData);

      expect(result).toEqual({
        revisionId: 'rev-3',
        timestamp: 1672531230000,
        commands: [
          {
            ty: CommandType.STYLE,
            si: 0,
            ei: 5,
            s: {
              bold: true,
              italic: false
            },
            timestamp: 1672531230000
          }
        ]
      });
    });

    it('should handle multi commands', () => {
      const mockRawData = {
        changelog: {
          changes: [
            {
              ty: 'mlti', // multi command
              cmds: [
                {
                  ty: 'is',
                  ibi: 0,
                  s: 'Hello',
                  ts: 1672531240000,
                },
                {
                  ty: 'st',
                  si: 0,
                  ei: 5,
                  s: { bold: true },
                  ts: 1672531240000,
                }
              ],
              ts: 1672531240000,
            }
          ]
        },
        revisionId: 'rev-4',
        timestamp: 1672531240000
      };

      const result = parseRevisionData(mockRawData);

      expect(result).toEqual({
        revisionId: 'rev-4',
        timestamp: 1672531240000,
        commands: [
          {
            ty: CommandType.MULTI,
            cmds: [
              {
                ty: CommandType.INSERT,
                ibi: 0,
                s: 'Hello',
                timestamp: 1672531240000
              },
              {
                ty: CommandType.STYLE,
                si: 0,
                ei: 5,
                s: { bold: true },
                timestamp: 1672531240000
              }
            ],
            timestamp: 1672531240000
          }
        ]
      });
    });
  });

  describe('applyCommandsToDocument', () => {
    let document: string;

    beforeEach(() => {
      document = '';
    });

    it('should apply insert commands to document', () => {
      const commands: RevisionCommand[] = [
        {
          ty: CommandType.INSERT,
          ibi: 0,
          s: 'Hello',
          timestamp: 1672531200000
        },
        {
          ty: CommandType.INSERT,
          ibi: 5,
          s: ' world',
          timestamp: 1672531210000
        }
      ];

      const result = applyCommandsToDocument(document, commands);
      expect(result).toBe('Hello world');
    });

    it('should apply delete commands to document', () => {
      document = 'Hello world';
      const commands: RevisionCommand[] = [
        {
          ty: CommandType.DELETE,
          si: 5,
          ei: 11,
          timestamp: 1672531220000
        }
      ];

      const result = applyCommandsToDocument(document, commands);
      expect(result).toBe('Hello');
    });

    it('should apply multi commands to document', () => {
      const commands: RevisionCommand[] = [
        {
          ty: CommandType.MULTI,
          cmds: [
            {
              ty: CommandType.INSERT,
              ibi: 0,
              s: 'Hello',
              timestamp: 1672531240000
            },
            {
              ty: CommandType.INSERT,
              ibi: 5,
              s: ' world',
              timestamp: 1672531240000
            }
          ],
          timestamp: 1672531240000
        }
      ];

      const result = applyCommandsToDocument(document, commands);
      expect(result).toBe('Hello world');
    });
  });
});
