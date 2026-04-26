# syntax=docker/dockerfile:1.7
#
# Thin runtime image. All build work (npm ci, tsc, prisma generate, tests)
# happens on the GitHub Actions runner — this image just packages the
# pre-built output.
#
# Expected to be built with the following files/directories present in the
# build context:
#   - dist/                  (tsc output)
#   - src/generated/         (prisma generate output)
#   - prisma/                (schema, migrations)
#   - node_modules/          (prod-only, installed via `npm ci --omit=dev`)
#   - package.json

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Non-root user
RUN addgroup -S app && adduser -S app -G app

COPY --chown=app:app node_modules ./node_modules
COPY --chown=app:app dist ./dist
COPY --chown=app:app src/generated ./src/generated
COPY --chown=app:app prisma ./prisma
COPY --chown=app:app package.json ./

USER app
EXPOSE 3001
CMD ["node", "dist/src/index.js"]
