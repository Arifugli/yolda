FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
# The optional secret supplies this cloud machine's trusted public CA bundle.
# It is used only during dependency installation and is not copied into the image.
RUN --mount=type=secret,id=env_ca,required=false \
    if [ -f /run/secrets/env_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/env_ca; fi; \
    npm ci --fetch-retries=1 --fetch-timeout=20000
COPY --chown=node:node . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && mkdir -p storage/objects && chown -R node:node storage .next
USER node
EXPOSE 3000
CMD ["sh", "scripts/start-cloud.sh"]
