/**
 * PlaybackView component for displaying document content
 * Shows the document at a specific revision and updates when playback engine state changes
 */

import React, { useEffect, useState } from 'react';
import { PlaybackEngine } from '@/core/playbackEngine';
import { PlaybackState } from '@/core/types';

interface PlaybackViewProps {
  playbackEngine: PlaybackEngine;
}

const PlaybackView: React.FC<PlaybackViewProps> = ({ playbackEngine }) => {
  // State to track document content and playback state
  const [documentContent, setDocumentContent] = useState<string>('');
  const [playbackState, setPlaybackState] = useState<PlaybackState>(PlaybackState.IDLE);
  const [revisionIndex, setRevisionIndex] = useState<number>(-1);

  // Update state when playback engine changes
  useEffect(() => {
    // Initial update
    updateFromPlaybackEngine();

    // Setup interval to check for updates (simulating event listeners)
    const intervalId = setInterval(updateFromPlaybackEngine, 100);

    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [playbackEngine]);

  // This effect is needed for tests to properly detect changes
  useEffect(() => {
    updateFromPlaybackEngine();
  }, [playbackEngine.getCurrentContent(), playbackEngine.getState(), playbackEngine.getCurrentRevisionIndex()]);

  /**
   * Update component state from playback engine
   */
  const updateFromPlaybackEngine = () => {
    const content = playbackEngine.getCurrentContent();
    const state = playbackEngine.getState();
    const index = playbackEngine.getCurrentRevisionIndex();

    // Only update state if something has changed to avoid unnecessary renders
    if (
      content !== documentContent ||
      state !== playbackState ||
      index !== revisionIndex
    ) {
      setDocumentContent(content);
      setPlaybackState(state);
      setRevisionIndex(index);
    }
  };

  /**
   * Format document content for display
   * Preserves whitespace and line breaks
   */
  const formatDocumentContent = (content: string) => {
    // Replace newlines with <br> tags for proper HTML rendering
    return content.split('\n').map((line, index) => (
      <React.Fragment key={index}>
        {line}
        {index < content.split('\n').length - 1 && <br />}
      </React.Fragment>
    ));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Document info header */}
      <div className="bg-gray-100 p-4 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <div>
            <span
              data-testid="revision-info"
              className="text-sm font-medium text-gray-700 mr-4"
            >
              Revision: {revisionIndex}
            </span>
            <span
              data-testid="playback-state"
              className="text-sm font-medium text-gray-700"
            >
              State: {playbackState}
            </span>
          </div>
        </div>
      </div>

      {/* Document content */}
      <div className="flex-grow overflow-auto p-6 bg-white">
        {playbackState === PlaybackState.LOADING ? (
          <div className="flex justify-center items-center h-full">
            <div className="animate-pulse flex flex-col items-center">
              <div className="h-12 w-12 rounded-full bg-blue-400 mb-4"></div>
              <p className="text-gray-600 font-medium">Loading document...</p>
            </div>
          </div>
        ) : documentContent ? (
          <div
            data-testid="document-content"
            className="prose max-w-none"
          >
            {formatDocumentContent(documentContent)}
          </div>
        ) : (
          <div className="flex justify-center items-center h-full">
            <p className="text-gray-500">No document content to display</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlaybackView;
