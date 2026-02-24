FROM node:22-alpine

WORKDIR /app

# Copiar dependências
COPY package*.json ./
RUN npm ci --only=production

# Copiar código fonte e compilar
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Remover devDependencies após o build
RUN npm prune --production

EXPOSE 3000

CMD ["node", "dist/index.js"]
