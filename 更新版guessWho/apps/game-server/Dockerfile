FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
RUN npm ci && npm run build --workspace @guesswho/game-server && npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "apps/game-server/dist/server.js"]
