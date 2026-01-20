# WeChat Robot Management System Implementation Plan

This plan outlines the development of a full-stack WeChat Robot system using **Wechaty** (Node.js) for the bot engine, ensuring extensibility and reliability.

## 1. Technology Stack

*   **Runtime**: Node.js (TypeScript)
*   **Bot Framework**: [Wechaty](https://wechaty.js.org/) (Standard industry choice, supports multiple protocols)
    *   *Note*: Will use the default free web protocol. If login fails due to account restrictions, the architecture allows switching to other "Puppets" easily.
*   **Backend API**: Express.js
*   **Frontend**: React + Tailwind CSS + Lucide React (Icons)
*   **Database**: SQLite (via `better-sqlite3` and `Kysely` or raw SQL for simplicity) - Local, fast, reliable.
*   **Scheduling**: `node-schedule`

## 2. Architecture Design

The project will be a monorepo with two main components running concurrently:

### A. Server (`/server`)
1.  **Bot Manager**: Wraps the Wechaty instance.
    *   Handles QR Code generation (pushes to frontend).
    *   Maintains session persistence.
    *   Listens for messages/errors.
2.  **REST API**:
    *   `GET /status`: Current bot state (waiting_for_scan, logged_in, offline).
    *   `GET /qr`: Returns the latest QR code.
    *   `GET /contacts/groups`: Fetches loaded chat rooms.
    *   `GET /tasks`: Lists scheduled tasks.
    *   `POST /tasks`: Creates a new message task.
3.  **Task Scheduler**:
    *   Runs a background job to check the database for pending tasks.
    *   Executes message sending (Text, Image, File) when time arrives.

### B. Client (`/client`)
1.  **Dashboard**: Shows connection status and QR code login interface.
2.  **Group Manager**: Table view of groups with member counts and IDs.
3.  **Task Manager**: Form to schedule messages (Select Group/User -> Input Content -> Pick Time).
4.  **Mobile Support**: Responsive layout ensuring usability on phone browsers.

## 3. Implementation Steps

### Phase 1: Project Scaffolding
1.  Initialize project structure (Server & Client).
2.  Install dependencies (Wechaty, Express, React, etc.).

### Phase 2: Server-side Core (Bot & Auth)
1.  Implement Wechaty initialization.
2.  Handle `scan` event to expose QR code.
3.  Handle `login` / `logout` events.
4.  Implement persistence (saving `memory-card` for session resumption).

### Phase 3: Data Management & API
1.  Setup SQLite database schema (`tasks`, `logs`).
2.  Create API endpoints for retrieving groups (Contacts) and managing tasks.
3.  Implement the Scheduler logic (Cron-style or Date-based triggering).

### Phase 4: Frontend Development
1.  **Login View**: Display the QR code and refresh mechanism.
2.  **Group List**: Fetch and display groups from the bot.
3.  **Task Creator**: UI to compose messages and set schedule.
4.  **Mobile Optimization**: Ensure standard CSS media queries cover mobile use cases.

### Phase 5: Testing & Reliability
1.  Test QR login flow.
2.  Test scheduled message delivery reliability.
3.  Add error handling (e.g., if bot disconnects, pause tasks).

## 4. Verification Plan
-   **Verification 1**: Start the server, open the web page, scan QR, and confirm login.
-   **Verification 2**: Schedule a text message for 1 minute in the future to a specific group ("File Transfer Helper" or a real group) and verify receipt.
-   **Verification 3**: Check mobile view responsiveness in browser dev tools.
