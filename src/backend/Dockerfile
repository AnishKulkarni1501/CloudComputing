FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY src/backend/package*.json ./
RUN npm ci --omit=dev
COPY src/backend/server.js ./src/backend/server.js
EXPOSE 5000
CMD ["node", "src/backend/server.js"]
