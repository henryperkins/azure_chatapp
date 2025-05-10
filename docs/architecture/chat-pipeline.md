# Chat Initialization Pipeline and UI Architecture: Living Documentation

This document contains the block diagram and sequence diagram for the chat initialization pipeline, intended as living documentation.

## Textual Block-Diagram

```
 ┌──────────────┐   import           ┌─────────────────┐
 │ app.js       │ ────────────────→ │ DependencySystem│
 └────┬─────────┘                   └──────┬──────────┘
      │ init()                                     ▲ register(...)
      │                                            │
      │ 1. Core DI creation                        │
      │ 2. createNotify()                          │
      │ 3. createEventHandlers() ───────┐          │
      │ 4. createApiClient()            │          │
      │ 5. createChatManager()◀─────────┘          │
      │ 6. createProjectManager()                 ...
      │ 7. UI bootstrap (htmlTemplateLoader etc.)
      │
      │ DOM ready → waitForDepsAndDom() ⇢                                       (async)
      │
      └─▶ registerAppListeners()
           ├─ trackListener(window,'locationchange') → handleNavigationChange()
           ├─ setupChatInitializationTrigger()
           └─ global auth / error hooks
```

## Sequence Diagram: First Page Load → First Message

Legend:  JS-call  →,  async/await ⇢,  custom DOM event ~~>

```
Browser       app.js                DependencySystem      chatManager            eventHandlers        API
   │ DOMContentLoaded
   │→ init()
   │  createDomAPI() etc.
   │  createNotify()
   │  createEventHandlers()
   │  createChatManager()
   │  register('chatManager',inst)
   │→ registerAppListeners()
   │
   │ handleNavigationChange()
   │  (URL ?project=123&chatId=abc)
   │→ pm.loadProjectDetails(123) ⇢
   │                                                ⇢ GET /api/projects/123
   │                                                ⇠
   │  pm emits 'projectLoaded' ~~>
   │
   │  await chatManager.initialize({projectId:123,...}) ⇢
   │      _setupUIElements()
   │      _bindEvents()   (trackListener adds DOM handlers)
   │      loadConversation('abc') ⇢
   │                               parallel
   │                               ├─ GET /projects/123/conversations/abc
   │                               └─ GET /projects/123/conversations/abc/messages
   │                               (Promise.all) ⇠
   │      _renderMessages()
   │      _updateURLWithConversationId()
   │      dispatch 'chatmanager:initialized' ~~>
   │  resolve initialize()
   │
User types message
   │ keydown (Enter) ─tracked→  sendMessage()  → queue.add()
   │ queue.process()
   │ _sendMessageToAPI() ⇢ POST /projects/123/conversations/abc/messages
   │                                            ⇠ {assistant_message: ...}
   │ _processAssistantResponse()
   │ _showMessage('assistant', ...)
