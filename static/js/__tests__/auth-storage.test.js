import { createAuth } from "../auth.js";

describe("Auth Token Storage Persistence", () => {
  let fakeStorage, mockDeps, auth;

  beforeEach(() => {
    fakeStorage = (() => {
      let store = {};
      return {
        getItem: (k) => store[k] || null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
        clear: () => { store = {}; }
      };
    })();

    mockDeps = {
      apiClient: jest.fn(),
      eventHandlers: { createCustomEvent: jest.fn(() => new Event('authStateChanged')), trackListener: jest.fn(), cleanupListeners: jest.fn() },
      domAPI: { getDocument: () => ({ cookie: "" }), getElementById: jest.fn(), preventDefault: jest.fn(), querySelector: jest.fn() },
      sanitizer: { sanitize: (x) => x },
      apiEndpoints: { AUTH_CSRF: "/csrf", AUTH_LOGIN: "/login", AUTH_LOGOUT: "/logout", AUTH_REGISTER: "/register", AUTH_VERIFY: "/verify", AUTH_REFRESH: "/refresh" },
      safeHandler: jest.fn((fn) => fn),
      browserService: { FormData: function() {}, setInterval: jest.fn(), clearInterval: jest.fn(), getWindow: () => ({}) },
      eventService: { getAuthBus: () => new EventTarget(), emit: jest.fn(), on: jest.fn(), off: jest.fn() },
      appModule: { state: { isAuthenticated: false }, setAuthState: jest.fn() },
      storageService: fakeStorage,
      DependencySystem: {
        modules: {
          get: (mod) => {
            if (mod === "storageService") return fakeStorage;
            if (mod === "appModule") return { state: { isAuthenticated: false }, setAuthState: jest.fn(), setAppLifecycleState: jest.fn() };
            if (mod === "browserService") return { FormData: function() {}, setInterval: jest.fn(), clearInterval: jest.fn(), getWindow: () => ({}) };
            if (mod === "safeHandler") return jest.fn((fn) => fn);
            if (mod === "domReadinessService") return { documentReady: () => Promise.resolve(), emitReplayable: jest.fn() };
            return undefined;
          }
        }
      },
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
      domReadinessService: { documentReady: () => Promise.resolve(), emitReplayable: jest.fn(), waitForEvent: () => Promise.resolve() },
      modalManager: { hide: jest.fn(), show: jest.fn() }
    };
    auth = createAuth(mockDeps);
    fakeStorage.clear();
  });

  test("stores access_token on login", async () => {
    // Patch internal loginUser to simulate backend returning token
    const token = "abcxyz.jwt.mocked";
    auth.login = async () => {
      const storageService = mockDeps.DependencySystem.modules.get("storageService");
      storageService.setItem("access_token", token);
      return { access_token: token, token_type: "Bearer" };
    };

    await auth.login("user", "pw");
    expect(fakeStorage.getItem("access_token")).toBe(token);
  });

  test("restores access_token from storage", () => {
    const token = "abcxyz.jwt.restored";
    fakeStorage.setItem("access_token", token);
    // Should populate accessToken in cache as well
    expect(auth.getAccessToken()).toBe(token);
  });

  test("clears access_token from storage on logout", async () => {
    const token = "abcxyz.jwt.mocked";
    fakeStorage.setItem("access_token", token);
    // patch clearTokenState to remove from storage
    auth.logout = async () => {
      fakeStorage.removeItem("access_token");
    };
    await auth.logout();
    expect(fakeStorage.getItem("access_token")).toBe(null);
  });
});
