# Contexte de build : racine du dépôt  (docker build -f apps/api/Dockerfile .)
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci
COPY apps/api apps/api
RUN npm -w apps/api run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/migrations apps/api/migrations
COPY --from=build /repo/apps/api/package.json apps/api/package.json
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
# Les migrations sont lancées explicitement (voir README), pas au démarrage.
CMD ["node", "dist/main.js"]
