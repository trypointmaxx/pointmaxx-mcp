# For Smithery's build: the server has no dependencies, so the image is just Node and these files.
FROM node:20-alpine
WORKDIR /app
COPY . .
ENTRYPOINT ["node", "server.mjs"]
