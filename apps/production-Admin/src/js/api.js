export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class ApiClient {
  constructor(baseUrl, fetchImplementation = (...args) => globalThis.fetch(...args)) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.fetchImplementation = fetchImplementation;
    this.token = "";
    this.refreshToken = "";
    this.onUnauthorized = () => {};
    this.onTokensRefreshed = null;
    this.cache = new Map();
    this.pending = new Map();
    this.refreshPromise = null;
  }

  setToken(token) {
    this.token = token || "";
    if (!this.token) this.clearCache();
  }

  setTokens(accessToken, refreshToken) {
    this.token = accessToken || "";
    this.refreshToken = refreshToken || "";
    if (!this.token) this.clearCache();
  }

  clearTokens() {
    this.token = "";
    this.refreshToken = "";
    this.refreshPromise = null;
    this.clearCache();
  }

  clearCache(prefix = "") {
    for (const key of this.cache.keys()) {
      if (!prefix || key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  async get(path, { ttl = 0, force = false } = {}) {
    const cached = this.cache.get(path);
    if (!force && cached && Date.now() - cached.storedAt < ttl) return cached.data;
    if (this.pending.has(path)) return this.pending.get(path);
    const promise = this.request(path)
      .then((data) => {
        this.cache.set(path, { data, storedAt: Date.now() });
        return data;
      })
      .finally(() => this.pending.delete(path));
    this.pending.set(path, promise);
    return promise;
  }

  async request(path, options = {}, retry = true) {
    if (!this.baseUrl) throw new ApiError("Admin API is not configured", 0);
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    // Silent refresh: access tokens live 15 minutes, so a 401 mid-session
    // retries once with a fresh pair instead of dumping the admin to login.
    // Auth endpoints never retry (a 401 there means a bad code).
    if (response.status === 401 && retry && this.refreshToken && !path.startsWith("/auth/")) {
      if (await this.tryRefresh()) return this.request(path, options, false);
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) this.onUnauthorized();
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(". ") : data.message;
      throw new ApiError(message || "The request could not be completed", response.status);
    }
    if ((options.method || "GET").toUpperCase() !== "GET") this.clearCache("/admin");
    return data;
  }

  // Single-flight: refresh rotates (revokes the old session), so concurrent
  // 401s must share one refresh call instead of racing with the same token.
  async tryRefresh() {
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          const response = await this.fetchImplementation(`${this.baseUrl}/auth/refresh`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ refreshToken: this.refreshToken }),
          });
          if (!response.ok) return false;
          const pair = await response.json().catch(() => ({}));
          if (!pair?.accessToken || !pair?.refreshToken) return false;
          this.setTokens(pair.accessToken, pair.refreshToken);
          this.onTokensRefreshed?.(pair.accessToken, pair.refreshToken);
          return true;
        } catch {
          return false;
        } finally {
          this.refreshPromise = null;
        }
      })();
    }
    return this.refreshPromise;
  }
}
