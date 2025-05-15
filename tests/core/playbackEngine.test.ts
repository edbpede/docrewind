import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseRevisionData,
  applyCommandsToDocument,
  PlaybackEngine
} from '@/core/playbackEngine';
import {
  CommandType,
  // Import only what we use to avoid unused import warnings
  RevisionCommand,
  RevisionData,
  PlaybackState
} from '@/core/types';

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

// New tests for the PlaybackEngine class
describe('PlaybackEngine - State Management', () => {
  let playbackEngine: PlaybackEngine;
  let mockRevisions: RevisionData[];

  beforeEach(() => {
    // Setup mock revision data for testing
    mockRevisions = [
      {
        revisionId: 'rev-1',
        timestamp: 1672531200000,
        commands: [
          {
            ty: CommandType.INSERT,
            ibi: 0,
            s: 'Hello',
            timestamp: 1672531200000
          }
        ]
      },
      {
        revisionId: 'rev-2',
        timestamp: 1672531210000,
        commands: [
          {
            ty: CommandType.INSERT,
            ibi: 5,
            s: ' world',
            timestamp: 1672531210000
          }
        ]
      },
      {
        revisionId: 'rev-3',
        timestamp: 1672531220000,
        commands: [
          {
            ty: CommandType.INSERT,
            ibi: 11,
            s: '!',
            timestamp: 1672531220000
          }
        ]
      }
    ];

    // Initialize the playback engine with mock revisions
    playbackEngine = new PlaybackEngine(mockRevisions);
  });

  describe('initialization', () => {
    it('should initialize with the correct state', () => {
      expect(playbackEngine.getState()).toBe(PlaybackState.IDLE);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(-1);
      expect(playbackEngine.getCurrentContent()).toBe('');
    });
  });

  describe('step forward/backward', () => {
    it('should step forward through revisions', () => {
      // Step to first revision
      playbackEngine.stepForward();
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(0);
      expect(playbackEngine.getCurrentContent()).toBe('Hello');

      // Step to second revision
      playbackEngine.stepForward();
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(1);
      expect(playbackEngine.getCurrentContent()).toBe('Hello world');

      // Step to third revision
      playbackEngine.stepForward();
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(2);
      expect(playbackEngine.getCurrentContent()).toBe('Hello world!');

      // Try to step beyond the last revision
      playbackEngine.stepForward();
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(2); // Should stay at the last revision
      expect(playbackEngine.getCurrentContent()).toBe('Hello world!');
    });

    it('should step backward through revisions', () => {
      // First go to the end
      playbackEngine.jumpToRevision(2);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(2);
      expect(playbackEngine.getCurrentContent()).toBe('Hello world!');

      // Step back to second revision
      playbackEngine.stepBackward();
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(1);
      expect(playbackEngine.getCurrentContent()).toBe('Hello world');

      // Step back to first revision
      playbackEngine.stepBackward();
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(0);
      expect(playbackEngine.getCurrentContent()).toBe('Hello');

      // Try to step before the first revision
      playbackEngine.stepBackward();
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(-1); // Should go to initial state
      expect(playbackEngine.getCurrentContent()).toBe('');
    });
  });

  describe('jump to revision', () => {
    it('should jump to a specific revision', () => {
      // Jump to second revision
      playbackEngine.jumpToRevision(1);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(1);
      expect(playbackEngine.getCurrentContent()).toBe('Hello world');

      // Jump to first revision
      playbackEngine.jumpToRevision(0);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(0);
      expect(playbackEngine.getCurrentContent()).toBe('Hello');

      // Jump to invalid revision (negative)
      playbackEngine.jumpToRevision(-1);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(-1);
      expect(playbackEngine.getCurrentContent()).toBe('');

      // Jump to invalid revision (beyond array)
      playbackEngine.jumpToRevision(10);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(2); // Should go to last revision
      expect(playbackEngine.getCurrentContent()).toBe('Hello world!');
    });
  });

  describe('play/pause', () => {
    beforeEach(() => {
      // Mock the setTimeout function
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should play through revisions', () => {
      playbackEngine.play();
      expect(playbackEngine.getState()).toBe(PlaybackState.PLAYING);

      // Fast-forward through the timeouts
      vi.advanceTimersByTime(100); // Default interval is 100ms
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(0);
      expect(playbackEngine.getCurrentContent()).toBe('Hello');

      vi.advanceTimersByTime(100);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(1);
      expect(playbackEngine.getCurrentContent()).toBe('Hello world');

      vi.advanceTimersByTime(100);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(2);
      expect(playbackEngine.getCurrentContent()).toBe('Hello world!');

      // Should stop at the end
      vi.advanceTimersByTime(100);
      expect(playbackEngine.getState()).toBe(PlaybackState.IDLE);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(2);
    });

    it('should pause playback', () => {
      playbackEngine.play();
      expect(playbackEngine.getState()).toBe(PlaybackState.PLAYING);

      vi.advanceTimersByTime(100);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(0);

      playbackEngine.pause();
      expect(playbackEngine.getState()).toBe(PlaybackState.PAUSED);

      // Advancing time should not change the state when paused
      vi.advanceTimersByTime(500);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(0);
      expect(playbackEngine.getCurrentContent()).toBe('Hello');
    });

    it('should resume playback from paused state', () => {
      playbackEngine.play();
      vi.advanceTimersByTime(100);
      playbackEngine.pause();
      expect(playbackEngine.getState()).toBe(PlaybackState.PAUSED);

      playbackEngine.play();
      expect(playbackEngine.getState()).toBe(PlaybackState.PLAYING);

      vi.advanceTimersByTime(100);
      expect(playbackEngine.getCurrentRevisionIndex()).toBe(1);
      expect(playbackEngine.getCurrentContent()).toBe('Hello world');
    });
  });
});
