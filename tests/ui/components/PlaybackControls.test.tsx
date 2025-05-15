import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlaybackControls from '@/ui/components/PlaybackControls';
import { PlaybackEngine } from '@/core/playbackEngine';
import { PlaybackState, RevisionData, CommandType } from '@/core/types';

// Mock the playback engine
vi.mock('@/core/playbackEngine', () => {
  const PlaybackEngineMock = vi.fn();
  PlaybackEngineMock.prototype.play = vi.fn();
  PlaybackEngineMock.prototype.pause = vi.fn();
  PlaybackEngineMock.prototype.getState = vi.fn();

  return {
    PlaybackEngine: PlaybackEngineMock
  };
});

describe('PlaybackControls Component', () => {
  let mockPlaybackEngine: PlaybackEngine;

  beforeEach(() => {
    // Initialize mock playback engine
    mockPlaybackEngine = new PlaybackEngine([]);

    // Reset mock function calls
    vi.clearAllMocks();

    // Mock timers for testing useEffect intervals
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Restore timers
    vi.restoreAllMocks();
  });

  it('should render play button when in idle state', () => {
    // Mock the playback state as IDLE
    (mockPlaybackEngine.getState as any).mockReturnValue(PlaybackState.IDLE);

    render(<PlaybackControls playbackEngine={mockPlaybackEngine} />);

    // Check if the play button is rendered
    const playButton = screen.getByTestId('play-button');
    expect(playButton).toBeInTheDocument();

    // Verify that getState was called
    expect(mockPlaybackEngine.getState).toHaveBeenCalled();
  });

  it('should render pause button when in playing state', () => {
    // Mock the playback state as PLAYING
    (mockPlaybackEngine.getState as any).mockReturnValue(PlaybackState.PLAYING);

    render(<PlaybackControls playbackEngine={mockPlaybackEngine} />);

    // Check if the pause button is rendered
    const pauseButton = screen.getByTestId('pause-button');
    expect(pauseButton).toBeInTheDocument();

    // Verify that getState was called
    expect(mockPlaybackEngine.getState).toHaveBeenCalled();
  });

  it('should call play method when play button is clicked', () => {
    // Mock the playback state as IDLE
    (mockPlaybackEngine.getState as any).mockReturnValue(PlaybackState.IDLE);

    render(<PlaybackControls playbackEngine={mockPlaybackEngine} />);

    // Find and click the play button
    const playButton = screen.getByTestId('play-button');
    fireEvent.click(playButton);

    // Verify that play method was called
    expect(mockPlaybackEngine.play).toHaveBeenCalled();
  });

  it('should call pause method when pause button is clicked', () => {
    // Mock the playback state as PLAYING
    (mockPlaybackEngine.getState as any).mockReturnValue(PlaybackState.PLAYING);

    render(<PlaybackControls playbackEngine={mockPlaybackEngine} />);

    // Find and click the pause button
    const pauseButton = screen.getByTestId('pause-button');
    fireEvent.click(pauseButton);

    // Verify that pause method was called
    expect(mockPlaybackEngine.pause).toHaveBeenCalled();
  });

  it('should render play button when in paused state', () => {
    // Mock the playback state as PAUSED
    (mockPlaybackEngine.getState as any).mockReturnValue(PlaybackState.PAUSED);

    render(<PlaybackControls playbackEngine={mockPlaybackEngine} />);

    // Check if the play button is rendered
    const playButton = screen.getByTestId('play-button');
    expect(playButton).toBeInTheDocument();

    // Verify that getState was called
    expect(mockPlaybackEngine.getState).toHaveBeenCalled();
  });

  it('should update button when playback state changes', () => {
    // Initially mock the playback state as IDLE
    (mockPlaybackEngine.getState as any).mockReturnValue(PlaybackState.IDLE);

    const { rerender } = render(<PlaybackControls playbackEngine={mockPlaybackEngine} />);

    // Check if the play button is rendered initially
    expect(screen.getByTestId('play-button')).toBeInTheDocument();

    // Change the mock return value to simulate state change to PLAYING
    (mockPlaybackEngine.getState as any).mockReturnValue(PlaybackState.PLAYING);

    // Force the component to update by triggering the useEffect
    // This simulates the interval that checks for state changes
    vi.advanceTimersByTime(100);

    // Re-render with the same props to trigger update
    rerender(<PlaybackControls playbackEngine={mockPlaybackEngine} />);

    // Check if the pause button is now rendered
    expect(screen.getByTestId('pause-button')).toBeInTheDocument();
  });
});
