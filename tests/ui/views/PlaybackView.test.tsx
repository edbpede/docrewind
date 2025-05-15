import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlaybackView from '@/ui/views/PlaybackView';
import { PlaybackEngine } from '@/core/playbackEngine';
import { PlaybackState, RevisionData, CommandType } from '@/core/types';

// Mock the PlaybackControls component
vi.mock('@/ui/components/PlaybackControls', () => ({
  default: vi.fn().mockImplementation(({ playbackEngine }) => (
    <div data-testid="mock-playback-controls">Playback Controls</div>
  ))
}));

// Mock the playback engine
vi.mock('@/core/playbackEngine', () => {
  const PlaybackEngineMock = vi.fn();
  PlaybackEngineMock.prototype.getCurrentContent = vi.fn();
  PlaybackEngineMock.prototype.getState = vi.fn();
  PlaybackEngineMock.prototype.getCurrentRevisionIndex = vi.fn();
  PlaybackEngineMock.prototype.stepForward = vi.fn();
  PlaybackEngineMock.prototype.stepBackward = vi.fn();
  PlaybackEngineMock.prototype.play = vi.fn();
  PlaybackEngineMock.prototype.pause = vi.fn();
  PlaybackEngineMock.prototype.reset = vi.fn();
  PlaybackEngineMock.prototype.jumpToRevision = vi.fn();

  return {
    PlaybackEngine: PlaybackEngineMock
  };
});

describe('PlaybackView Component', () => {
  let mockPlaybackEngine: PlaybackEngine;
  let mockRevisions: RevisionData[];

  beforeEach(() => {
    // Create mock revision data
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
      }
    ];

    // Initialize mock playback engine
    mockPlaybackEngine = new PlaybackEngine(mockRevisions);

    // Setup mock return values
    (mockPlaybackEngine.getCurrentContent as any).mockReturnValue('Hello world');
    (mockPlaybackEngine.getState as any).mockReturnValue(PlaybackState.IDLE);
    (mockPlaybackEngine.getCurrentRevisionIndex as any).mockReturnValue(1);
  });

  it('should render document content from playback engine', () => {
    render(<PlaybackView playbackEngine={mockPlaybackEngine} />);

    // Check if the document content is rendered
    expect(screen.getByTestId('document-content')).toHaveTextContent('Hello world');

    // Verify that getCurrentContent was called
    expect(mockPlaybackEngine.getCurrentContent).toHaveBeenCalled();
  });

  it('should display the current revision index', () => {
    render(<PlaybackView playbackEngine={mockPlaybackEngine} />);

    // Check if the revision index is displayed
    expect(screen.getByTestId('revision-info')).toHaveTextContent('Revision: 1');

    // Verify that getCurrentRevisionIndex was called
    expect(mockPlaybackEngine.getCurrentRevisionIndex).toHaveBeenCalled();
  });

  it('should display the current playback state', () => {
    render(<PlaybackView playbackEngine={mockPlaybackEngine} />);

    // Check if the playback state is displayed
    expect(screen.getByTestId('playback-state')).toHaveTextContent('State: idle');

    // Verify that getState was called
    expect(mockPlaybackEngine.getState).toHaveBeenCalled();
  });

  it('should update when playback engine state changes', () => {
    // First render with initial state
    const { rerender } = render(<PlaybackView playbackEngine={mockPlaybackEngine} />);

    // Change the mock return values to simulate state change
    (mockPlaybackEngine.getCurrentContent as any).mockReturnValue('Hello world!');
    (mockPlaybackEngine.getState as any).mockReturnValue(PlaybackState.PAUSED);
    (mockPlaybackEngine.getCurrentRevisionIndex as any).mockReturnValue(2);

    // Re-render with the same props to trigger update
    rerender(<PlaybackView playbackEngine={mockPlaybackEngine} />);

    // Check if the UI has updated
    expect(screen.getByTestId('document-content')).toHaveTextContent('Hello world!');
    expect(screen.getByTestId('playback-state')).toHaveTextContent('State: paused');
    expect(screen.getByTestId('revision-info')).toHaveTextContent('Revision: 2');
  });

  it('should render the PlaybackControls component', () => {
    render(<PlaybackView playbackEngine={mockPlaybackEngine} />);

    // Check if the PlaybackControls component is rendered
    expect(screen.getByTestId('mock-playback-controls')).toBeInTheDocument();
  });
});
