# Should I Live Here

Enter an NYC address, get one report with two scores derived from NYC 311
complaint data: a **Building Health Score** and a **Block Quality Score**.

| Directory | What it is | Setup |
| --- | --- | --- |
| [`backend/`](backend/README.md) | Express API — 311 scoring, caching, AI explanations | [backend/README.md](backend/README.md) |
| [`front/`](front/README.md) | Next.js frontend | [front/README.md](front/README.md) |

**New here?** Start with [`backend/README.md`](backend/README.md) — it covers
Docker, environment variables, and the optional Ollama setup. The fastest path
to a running API is:

```bash
cd backend
docker compose up --build
curl localhost:3001/health
```
