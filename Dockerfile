FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts && npx --yes prisma@6.19.3 generate
COPY src ./src
EXPOSE 3000
CMD ["sh", "-c", "npx --yes prisma@6.19.3 migrate deploy && node src/server.js"]
