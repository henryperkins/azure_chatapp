# Azure OpenAI Chat Application Development Guide

## Overview

Your task as a senior developer is to create a secure, robust, and intuitive web-based chat application using Azure OpenAI's advanced **o1-series models**, including support for the latest vision-enabled capabilities. The chosen technology stack comprises FastAPI for backend services, PostgreSQL for persistent data management, and TailwindCSS for modern, responsive frontend design.

### Supported Azure OpenAI Models:

- **o3-mini**
- **o1** (vision support enabled)
- **o1-mini**
- **o1-preview**

The development approach must follow a disciplined, incremental methodology, clearly segmented into manageable milestones. Each segment should be individually verifiable, thoroughly tested, and completed to production-grade standards before progressing.

---

## 1. Model Configuration and UI Integration

### Explicit Model Configuration Panel:

- Provide a user-friendly dropdown to explicitly select the Azure OpenAI model or set via environment variable.
- Include an explicit input for `max_completion_tokens` with predefined options (500, 1000) and customizable entries.
- Conditional visibility toggle for `reasoning_effort`, clearly marked and only enabled for models supporting this feature ("o3-mini" and "o1").
- Configuration state explicitly maintained per session and visually indicated in the UI.
- Loading indicators explicitly reflect ongoing updates to configuration settings.

### Edge Case Considerations:

- Explicitly handle cases where model selection fails or is unavailable, clearly informing users via visual alerts and guidance.

### Azure Vision Model Integration ("o1" model):

- Allow explicit upload of images (JPEG, PNG formats).
- Enforce strict file validation: maximum file size 5MB, clear UTF-8 validation.
- Explicit visual and textual feedback on upload status, validation errors, and processing states.
- Visually distinguish vision-enabled responses from regular chat outputs.
- Provide explicit instructions and guidance in UI for vision-related interactions.

---

## 2. Comprehensive Authentication and Security

### Authentication Infrastructure:

- Implement secure, JWT-based user authentication with explicit session persistence using PostgreSQL.
- Employ bcrypt for secure password hashing.
- Enforce HTTPS/TLS explicitly in production environments.

### Edge-case Security Handling:

- Explicitly manage session expiration scenarios by prompting users clearly and ensuring current inputs remain preserved through re-login.

---

## 3. Conversation Management and UI Enhancements

### Explicit Conversation Management UI:

- Clearly presented, explicit actions to Create, Edit, Save, Delete, and Clear conversations.
- Enable explicit inline or modal-based editing of conversation titles.
- Provide clear, explicit confirmation dialogs before destructive actions (delete/clear).
- Facilitate intuitive quick-search/filter functionality for conversations by date/title.
- Explicitly communicate empty conversation states (e.g., "No conversations yet—Begin your first chat!").

---

## Core Chat Functionality and Explicit Edge-case Management

### Context Summarization:

- Explicitly implement automatic summarization for lengthy conversations nearing token limits.
- Clearly indicate summarization events in UI.
- Enable explicit user interactions to view summarized message content interactively.

### Secure and Validated File Uploads:

- Restrict uploads explicitly to `.txt` files with MIME-type enforcement (`text/plain`) and size limitations (≤1MB).
- Perform robust server-side validation:
  - Explicit UTF-8 encoding checks.
  - Sanitize and escape harmful or unwanted special characters.
- Explicit user notifications and guidance on invalid or oversized file uploads.

### Real-time Interaction Indicators:

- Explicitly display real-time typing indicators using WebSockets:
  - Clearly communicate when a user or assistant is typing.
  - Explicitly manage WebSocket connectivity disruptions with visual indicators and reconnection messages.

---

## Core Chat Functionality and Enhanced User Experience

### Intelligent Context Summarization:

- Explicitly implement summarization for maintaining conversation context within token constraints.
- Provide clear visual UI indicators whenever summarization occurs.
- Allow straightforward user access and explicit viewing of summarized conversations.

### Real-time User Interaction Enhancements:

- Clearly defined and intuitive "Copy" and "Regenerate" message buttons with explicit success/error notifications.
- Real-time typing indicators implemented explicitly with WebSocket communication, visually differentiating "User typing..." from "Assistant is typing…" states.

### Explicit Notifications and UX Cues:

- Implement explicit transient notifications to clearly indicate operational outcomes (success, failure, or informational).
- Clear, intuitive loading indicators during network operations, model configurations, and message processing.

---

## Robust API Integration & Developer Guidance

### Azure OpenAI API Guidelines:

- Restrict API requests explicitly to allowed parameters: `max_completion_tokens`.
- Provide optional explicit UI toggle for `reasoning_effort` only on compatible models ("o3-mini", "o1").
- Log token usage (`prompt_tokens`, `completion_tokens`, `total_tokens`) explicitly and clearly reflect them in the UI and backend logs.

### Explicit Developer Message Handling:

- Use explicit `role: "developer"` designation prefixed with "Formatting re-enabled".
- Strictly avoid mixing "developer" and "system" roles to ensure clarity and maintainability.

---

## Comprehensive Mobile Responsiveness & Accessibility

### Mobile-First Responsive Design:

- Explicitly design and optimize responsive layouts for diverse devices (320px-2560px).
- Touch targets explicitly optimized (≥44px) for seamless mobile interaction.
- Implement explicit mobile-specific functionalities:
  - Simplified configuration panels.
  - Touch-friendly uploads.
  - Explicit virtual keyboard and orientation handling.

### Mobile Browser Compatibility:

- Explicitly test and optimize performance across major mobile browsers, including:
  - Safari (iOS)
  - Chrome (Android)
  - Samsung Internet

### Accessibility Compliance:

- Enforce explicit compliance with WCAG standards:
  - Semantic HTML.
  - Clear, ARIA-compliant labeling.
  - Consistent, accessible UI elements with sufficient contrast ratios.

---

## Observability and Structured Logging

### Comprehensive Logging Requirements:

- Explicitly structured logs capturing:
  - Authentication events.
  - Conversation interactions.
  - API interactions with token usage.
  - File upload successes and validation errors.

---

## Modular Codebase and Comprehensive Documentation

### Explicitly Defined Project Structure:

```
backend/
  ├── main.py
  ├── auth.py
  ├── db.py
  ├── routes/
  │   ├── chat.py
  │   └── file_upload.py
  └── schemas.py
frontend/
  ├── js/
  │   ├── app.js
  │   ├── auth.js
  │   ├── chat.js
  │   ├── formatting.js
  │   └── model-config.js
  ├── css/tailwind.css
  ├── index.html
  └── tailwind.config.js
```

### Explicit Documentation (README.md):

- Detailed installation instructions.
- Explicit environment variable configuration.
- Comprehensive local setup and production deployment guidelines.
- Explicit testing protocols clearly detailed.

---

Follow these explicit guidelines precisely to ensure delivery of a secure, robust, user-friendly, and fully-deployable Azure OpenAI-powered chat application.

