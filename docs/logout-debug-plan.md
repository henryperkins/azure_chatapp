# Persistent Front-End Logout – Investigation & Instrumentation Plan

> Goal: identify **why the browser always treats the user as logged-out after any reload / navigation** even though `/login` succeeds and cookies are ostensibly set.

---

## 1  Most-Likely Root Causes to Check First

| Area | Why it causes logout every time | Evidence / What to look for |
|------|---------------------------------|-----------------------------|
| **Cookie attributes** (`secure`, `domain`, `path`, `samesite`, `httponly`) | Browser will silently drop a cookie that violates security rules (e.g. `Secure=True` on plain-HTTP `localhost`, wrong `Domain`, wrong `Path`). | DevTools ➜ Application ➜ Cookies right after `/login`. Are `access_token` / `refresh_token` still present *after reload*? Are they sent with every `/api/auth/verify` request? |
| **CSRF token flow** | If `csrf_token` cookie is absent/expired, server rejects `/verify` (401) and the frontend clears state. | Watch `/csrf` response & `Set-Cookie`. Does `getCSRFTokenAsync()` always succeed? |
| **Token-version bump / blacklist** | Backend increments `token_version` or blacklists the refresh token; every `/verify` then fails. | Server logs should now show `[TOKEN_VERSION_MISMATCH] …` (see instrumentation below). Look at `token_blacklist` table growth. |
| **Clock skew / wrong `exp`** | Client clock > JWT `exp` ⇒ immediate invalidation. | Decode JWT, compare `exp` vs `Date.now()` |
| **CORS / cross-site requests** | `SameSite=Lax` cookies are *not* included in certain cross-site or cross-port requests. | Are you serving frontend on a different port or domain? |

---

## 2  Frontend Diagnostics to Add (`static/js/auth.js`)

```javascript
// Utility
function logCookieState(tag = '') {
  console.info('[COOKIE_SNAPSHOT]', tag, document.cookie);
}

// Call sites
await authRequest(...);           logCookieState('after login');
await verifyAuthState(...);       logCookieState('before verify');
clearTokenState(...);             logCookieState('after clear');
AuthBus.addEventListener('authStateChanged', e => console.warn('[AUTH_EVENT]', e.detail));
```

Also patch `apiRequest()` once to log outgoing auth requests, headers & cookies.

---

## 3  Backend Diagnostics to Add

### 3.1  `utils/auth_utils.py::verify_token()`  *(exact file path)*

```python
# After decoded token and before raising mismatch
logger.warning(
    "[TOKEN_VERSION_MISMATCH] user=%s tok_ver=%s db_ver=%s jti=%s exp=%s iat=%s",
    sub,
    decoded.get("version"),
    user.token_version,
    decoded.get("jti"),
    decoded.get("exp"),
    decoded.get("iat"),
)
```

### 3.2  `auth.py::refresh_token()`  *(lines ~415 ff.)*

Inside the `except HTTPException as ex:` block, right before cookie-clearing:

```python
if ex.status_code == 401:
    logger.warning(
        "[REFRESH_VERSION_MISMATCH] user=%s detail=%s cookies=%s",
        locked_user.username if 'locked_user' in locals() else 'unknown',
        ex.detail,
        request.cookies,
    )
```

### 3.3  `auth.py::logout_user()`

After bumping `token_version`:

```python
logger.info(
    "[TOKEN_VERSION_INCREMENT] user=%s new_ver=%s reason=logout",
    locked.username,
    locked.token_version,
)
```

---

## 4  Step-by-Step Investigation Flow

```mermaid
flowchart TD
    A[User clicks Login] --> B[/login 200 + Set-Cookie]
    B --> |DevTools: cookies present?| C[Reload page]
    C --> D[/api/auth/verify]
    D -->|No cookies| E[Cookie attribute issue]
    D -->|Cookies sent but 401| F[Server reject]
    F --> F1{Reason?}
    F1 -->|expired| G[Clock / expiry]
    F1 -->|token version| H[DB version / blacklist]
    F1 -->|csrf| I[Missing/expired CSRF cookie]
```

---

## 5  Immediate Manual Checks

1. Log in once, **don’t reload**, open DevTools → Application → Cookies – confirm attributes.
2. Reload. Watch `/verify` request & response.
3. Tail backend logs; confirm new `[TOKEN_VERSION_MISMATCH]` or `[REFRESH_VERSION_MISMATCH]` entries.

---

*After implementing these diagnostics we should quickly see whether the problem is:*

* cookie not persisted,
* token invalidated by server, or
* request missing required CSRF header.
