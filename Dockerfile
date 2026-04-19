# Estágio de Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Estágio de Produção
FROM node:22-alpine
WORKDIR /app

# Variável de ambiente para garantir modo produção
ENV NODE_ENV=production

# Copia apenas o necessário do builder
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/serviceAccountKey.json ./serviceAccountKey.json

# O Cloud Run ignora o EXPOSE, mas é boa prática documentar a 8080
EXPOSE 8080

# Garanta que seu index.ts use process.env.PORT
CMD ["node", "dist/index.js"]
