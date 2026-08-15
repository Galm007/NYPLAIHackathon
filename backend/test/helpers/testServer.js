import { createApp } from "../../src/app.js";

/**
 * Boots the real app on an ephemeral port and returns a `fetch`-based client.
 *
 * Deliberately no supertest: the app is already listener-free via `createApp()`,
 * and binding port 0 exercises the same HTTP stack production uses (body
 * parsing, CORS middleware, error handler) with zero extra dependencies.
 */
export async function startTestServer() {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    /** GET/POST helper returning { status, body } with JSON already parsed. */
    async request(path, { method = "GET", body, headers } = {}) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: res.status, body: parsed, headers: res.headers };
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
