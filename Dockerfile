FROM node:24-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production DATA_DIR=/var/data
RUN mkdir -p /var/data
EXPOSE 3000
CMD ["node","server.js"]
