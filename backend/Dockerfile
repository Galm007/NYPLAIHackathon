# syntax=docker/dockerfile:1

# node:22-alpine matches the host Node (v22.16) and satisfies engines >=20.6.
# musl is a non-issue here: express and mongodb are pure JS, and the one
# musl-hostile package (mongodb-memory-server) is a devDependency that
# --omit=dev leaves out. Tests stay on the host.
FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

# Manifests first so the dependency layer only reinvalidates when they change,
# not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# scripts/ ships too, so `docker compose exec backend npm run baseline` and the
# verify:* tools are runnable inside the container.
COPY src ./src
COPY scripts ./scripts

USER node

EXPOSE 3001

# There is no curl in the alpine image, but Node 22 has a global fetch.
# /health is dependency-free, so this reports the process, not Mongo.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# npm start is `node --env-file-if-exists=.env src/index.js`. No .env is baked
# into the image (see .dockerignore), so that flag no-ops and all config
# arrives as container environment.
CMD ["npm", "start"]
