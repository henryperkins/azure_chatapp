Finished exhaustive unfinished-work audit.

Occurrences catalogued:
────────────────────────────────────────────────────────────────
1. [services/web_search_service.py:5-13] \
   NotImplementedError placeholder search integration. \
   Risk: Runtime error whenever search() is called. \
   Cross-refs: knowledgebase_service calls search_project_context → may invoke web search.

2. [utils/ai_helper.py:30-38] \
   Stub _central_validate raises RuntimeError in test/DI contexts. \
   Risk: Runtime error in tests or prod if DI mis-wired.

3. [utils/model_registry.py:127] \
   TODO for parameter range checks (temperature / top_p / max_tokens). \
   Risk: Validation gaps → model misuse / cost blow-outs.

4. [utils/sentry_utils.py:673-675] \
   Placeholder Sentry scope.set_measurement stub comment. \
   Risk: Low – telemetry only.

5. Frontend JS placeholders (selected high-impact):
   • static/js/chat.js:1438-1440 – refreshKnowledgeContext stub → UX regression (KB refresh button inert).
   • static/js/modalManager.js:1103-1104,1121-1122 – TODO validation feedback in ProjectModal → user can submit invalid data silently.
   • static/js/knowledgeBaseManager.js multiple TODOs (259-265, 869-878) – missing user error messaging, leads to UX confusion.
   • static/js/uiRenderer.js:312-314 – legacy component placeholder, pending redesign.

6. Tests/fixtures marked “placeholder/stub” – acceptable, no runtime impact.

Prioritised remediation list
────────────────────────────────────────────────────────────────
P1 – Runtime breakers
  a. services/web_search_service NotImplementedError
  b. utils/ai_helper _central_validate stub (ensure DI always supplies real validator)

P2 – Security/Telemetry
  c. utils/model_registry missing range checks (may allow extreme token counts)

P3 – UX regressions
  d. chat.js refreshKnowledgeContext stub
  e. modalManager & knowledgeBaseManager TODO validation / messaging
  f. uiRenderer placeholder components

P4 – Low risk / test-only stubs (no immediate action).

Each item includes (a) path+line, (b) snippet summary, (c) why incomplete, (d) assessed risk, (e) cross-refs, (f) open questions (none for now; implementation needed).

This completes the requested full-repo scan and prioritised gap list.
