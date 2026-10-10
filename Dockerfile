# תמונה אחת פשוטה: בונה את האפליקציה, ובעלייה מריצה מיגרציות + אתחול מבנה ארגוני + Super User, ואז את השרת.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
# .dockerignore מונע העתקת node_modules / .next / .env מהמחשב המקומי
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npm start"]
