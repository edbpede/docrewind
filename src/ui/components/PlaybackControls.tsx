/**
 * PlaybackControls component
 * Provides play and pause buttons to control the playback engine
 */

import React, { useEffect, useState } from 'react';
import { PlaybackEngine } from '@/core/playbackEngine';
import { PlaybackState } from '@/core/types';

interface PlaybackControlsProps {
  playbackEngine: PlaybackEngine;
}

const PlaybackControls: React.FC<PlaybackControlsProps> = ({ playbackEngine }) => {
  // State to track playback state
  const [playbackState, setPlaybackState] = useState<PlaybackState>(PlaybackState.IDLE);

  // Update state when playback engine changes
  useEffect(() => {
    // Initial update
    updateFromPlaybackEngine();

    // Setup interval to check for updates (simulating event listeners)
    const intervalId = setInterval(updateFromPlaybackEngine, 100);

    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [playbackEngine]);

  /**
   * Update component state from playback engine
   */
  const updateFromPlaybackEngine = () => {
    const state = playbackEngine.getState();

    // Only update state if something has changed to avoid unnecessary renders
    if (state !== playbackState) {
      setPlaybackState(state);
    }
  };

  /**
   * Handle play button click
   */
  const handlePlay = () => {
    playbackEngine.play();
  };

  /**
   * Handle pause button click
   */
  const handlePause = () => {
    playbackEngine.pause();
  };

  return (
    <div className="flex items-center justify-center space-x-4 p-4 bg-white rounded-md shadow-sm">
      {playbackState === PlaybackState.PLAYING ? (
        // Pause button
        <button
          data-testid="pause-button"
          onClick={handlePause}
          className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-colors"
          aria-label="Pause"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 9v6m4-6v6"
            />
          </svg>
        </button>
      ) : (
        // Play button
        <button
          data-testid="play-button"
          onClick={handlePlay}
          className="flex items-center justify-center w-12 h-12 rounded-full bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-colors"
          aria-label="Play"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
      )}
    </div>
  );
};

export default PlaybackControls;
