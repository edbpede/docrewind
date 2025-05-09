# DocRewind: Project Development Plan

This document outlines the phased development plan for the DocRewind browser extension.

## Overall Project Structure (Tree Overview)

```
docrewind/
├── dist/                     # Compiled extension files for Chrome & Firefox
├── public/                   # Static assets (icons, manifest.json)
│   ├── icons/
│   │   ├── icon16.png
│   │   ├── icon48.png
│   │   └── icon128.png
│   └── manifest.json         # Extension manifest
├── src/                      # Source code
│   ├── core/                 # Core logic (data fetching, parsing, playback engine)
│   │   ├── auth.ts
│   │   ├── dataFetcher.ts
│   │   ├── playbackEngine.ts
│   │   └── types.ts
│   ├── ui/                   # React components and UI logic
│   │   ├── components/       # Reusable UI components (e.g., playback controls, timeline, settings)
│   │   │   ├── PlaybackControls.tsx   # Handles play, pause, speed adjustment
│   │   │   ├── TimelineScrubber.tsx   # Allows navigating through document history
│   │   │   └── SettingsPanel.tsx      # For managing user preferences (e.g., default speed)
│   │   ├── views/            # Main UI views
│   │   │   └── PlaybackView.tsx
│   │   ├── index.tsx         # Entry point for React app
│   │   └── App.tsx
│   ├── background/           # Background scripts for the extension
│   │   └── index.ts
│   ├── contentScript/        # Content scripts for interacting with Google Docs pages
│   │   └── index.ts
│   └── utils/                # Utility functions (e.g., helpers, constants) shared across the extension
│       ├── constants.ts      # Shared constant values
│       ├── logger.ts         # Centralized logging utility
│       └── storageHelper.ts  # Helper functions for browser storage
├── tests/                    # Test files (unit, integration, e2e)
│   ├── core/
│   │   ├── auth.test.ts
│   │   └── dataFetcher.test.ts
│   ├── ui/
│   │   └── components/
│   │       └── PlaybackControls.test.tsx
│   └── e2e/
│       └── playback.spec.ts
├── .eslintrc.js
├── .prettierrc.js
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── package.json
├── webpack.config.js         # Or other bundler configuration
├── README.md
└── PROJECT_PLAN.md           # This file
```

## Phase 1: Foundation & Core Logic (TypeScript)

- **Task 1.1: Project Setup**
    - [ ] Initialize TypeScript project (`npm init`, `tsc --init`).
    - [ ] Setup linter (ESLint) and formatter (Prettier).
    - [ ] Setup testing framework (e.g., Jest or Vitest).
    - [ ] Define basic project structure (folders as per overview).
- **Task 1.2: Google OAuth Implementation**
    - [ ] Research Google OAuth requirements for accessing Google Docs data.
    - [ ] **Test:** Write initial tests for OAuth flow.
    - [ ] Implement OAuth 2.0 flow for user authentication.
        - [ ] Handle token acquisition, storage (securely, e.g., `chrome.storage.local`), and refresh.
    - [ ] **Test:** Verify successful authentication and token handling.
- **Task 1.3: Core Data Fetching Mechanism**
    - [ ] Investigate Google Docs API or other methods to access fine-grained edit data (this is the most challenging part, inspired by Draftback's approach).
    - [ ] **Test:** Write tests for mock API calls and data retrieval.
    - [ ] Develop `dataFetcher.ts` to retrieve revision data for a given document (respecting user permissions).
    - [ ] **Test:** Ensure correct data is fetched and errors are handled.
- **Task 1.4: Data Parsing & Transformation**
    - [ ] **Test:** Define expected output formats for parsed data and write tests.
    - [ ] Implement logic in `playbackEngine.ts` (or a dedicated parser module) to parse the raw edit data into a structured format suitable for playback.
        - [ ] Identify additions, deletions, and potentially formatting changes.
    - [ ] **Test:** Validate parsing logic against various document edit scenarios.
- **Task 1.5: Basic Playback Engine**
    - [ ] **Test:** Write tests for basic playback state transitions (e.g., step forward, step backward).
    - [ ] Develop initial version of `playbackEngine.ts` to manage the state of the document at different points in its history.
    - [ ] Implement functions to reconstruct document state based on parsed edits.
    - [ ] **Test:** Ensure document state is accurately reconstructed.

## Phase 2: User Interface (React & Tailwind CSS) & Initial Playback

- **Task 2.1: UI Setup**
    - [ ] Integrate React into the project.
    - [ ] Setup Tailwind CSS for styling.
    - [ ] Consider Headless UI for accessible components if complex interactions are foreseen.
- **Task 2.2: Basic Document Display View**
    - [ ] **Test:** Write basic tests for rendering document content.
    - [ ] Create `PlaybackView.tsx` to display the document content.
    - [ ] Connect `PlaybackView.tsx` to `playbackEngine.ts` to show the document at a specific revision.
    - [ ] **Test:** Ensure UI updates correctly when playback engine state changes.
- **Task 2.3: Playback Controls UI**
    - [ ] **Test:** Write tests for control interactions (play, pause).
    - [ ] Create `PlaybackControls.tsx` component with Play and Pause buttons.
    - [ ] Implement logic to trigger playback engine's play/pause functionality.
    - [ ] **Test:** Verify controls correctly interact with the playback engine.
- **Task 2.4: Extension Manifest & Basic Packaging (Chrome)**
    - [ ] Create `manifest.json` for Chrome extension (permissions for OAuth, activeTab, storage, scripting if needed for Google Docs).
    - [ ] Setup bundler (e.g., Webpack, Parcel) to package `src` into `dist`.
    - [ ] Implement basic background script (`background/index.ts`) for OAuth redirects and managing extension state.
    - [ ] Implement basic content script (`contentScript/index.ts`) if needed to inject UI or interact with Google Docs page.
    - [ ] **Test:** Load the extension in Chrome and test basic OAuth and UI display on a Google Doc.

## Phase 3: Advanced Playback Features & UI Refinement

- **Task 3.1: Speed Adjustment Control**
    - [ ] **Test:** Write tests for speed adjustment functionality.
    - [ ] Add speed control UI element to `PlaybackControls.tsx`.
    - [ ] Implement logic in `playbackEngine.ts` and UI to control playback speed.
    - [ ] **Test:** Verify playback speed changes as expected.
- **Task 3.2: Timeline/Scrubbing Bar**
    - [ ] **Test:** Write tests for timeline interaction and navigation.
    - [ ] Design and implement `TimelineScrubber.tsx` component.
    - [ ] Connect timeline to `playbackEngine.ts` to allow users to jump to specific points in history.
    - [ ] Visualize key revisions or time markers on the timeline.
    - [ ] **Test:** Ensure timeline accurately reflects history and allows navigation.
- **Task 3.3: UI Styling and Polish**
    - [ ] Apply Tailwind CSS styling to all UI components for a modern and intuitive look.
    - [ ] Ensure responsive design.
    - [ ] If using Headless UI, style the primitives.
    - [ ] **Test:** Perform UI/UX reviews and iterate on design.
- **Task 3.4: Error Handling and User Feedback**
    - [ ] Implement robust error handling for API calls, data parsing, and playback.
    - [ ] Provide clear user feedback for loading states, errors, and successful operations.
    - [ ] **Test:** Simulate error conditions and verify user feedback.

## Phase 4: Cross-Browser Compatibility & Data Management

- **Task 4.1: Firefox Compatibility**
    - [ ] Adapt `manifest.json` for Firefox (if differences exist, e.g., `browser_specific_settings`).
    - [ ] Test extension on Firefox.
    - [ ] Address any browser-specific issues (e.g., `chrome.*` vs `browser.*` APIs).
    - [ ] **Test:** Full regression testing on Firefox.
- **Task 4.2: User Preferences Storage**
    - [ ] **Test:** Write tests for storing and retrieving preferences.
    - [ ] Implement storage for user preferences (e.g., default playback speed) using `chrome.storage.local` or `browser.storage.local`.
    - [ ] Provide a simple UI for managing these preferences if necessary.
    - [ ] **Test:** Verify preferences are saved and loaded correctly.
- **Task 4.3: Data Caching (Optional, with care for privacy)**
    - [ ] Evaluate if minimal caching of fetched data is beneficial for performance.
    - [ ] If implementing, ensure data is stored securely and cleared appropriately (respecting privacy).
    - [ ] **Test:** If caching, test cache hits, misses, and invalidation.

## Phase 5: Testing, Refinement, Documentation & Release Prep

- **Task 5.1: Comprehensive Testing**
    - [ ] Write more extensive unit tests for core logic (TDD: should be ongoing).
    - [ ] Write integration tests for interactions between UI and core logic (TDD: should be ongoing).
    - [ ] Develop End-to-End (E2E) tests for key user flows (e.g., using Puppeteer or Playwright).
        - [ ] Full playback sequence.
        - [ ] OAuth flow.
- **Task 5.2: Code Refactoring and Optimization**
    - [ ] Review codebase for DRY principles and maintainability.
    - [ ] Profile and optimize performance if needed (especially playback smoothness and data handling).
- **Task 5.3: Privacy & Security Review**
    - [ ] Ensure OAuth tokens are handled securely.
    - [ ] Verify no unnecessary data is stored.
    - [ ] Confirm compliance with GDPR principles (data minimization, consent).
- **Task 5.4: Documentation**
    - [ ] Create `README.md` with clear setup and usage instructions.
    - [ ] Add inline code comments for complex sections.
    - [ ] Prepare brief user-facing documentation (how to use the extension).
- **Task 5.5: Release Preparation**
    - [ ] Create production builds for Chrome Web Store and Firefox Add-ons.
    - [ ] Prepare store listing materials (screenshots, description).

This plan is a guideline and may evolve as development progresses. Regular testing and adherence to DRY and TDD principles will be crucial throughout the project. 