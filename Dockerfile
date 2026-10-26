# ---- web build -------------------------------------------------------------
FROM node:24-bookworm-slim AS webbuild
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY services/package.json services/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN npm ci --ignore-scripts
COPY services services
COPY apps/web apps/web
RUN npm run build --workspace @quanstate/services && npm run build --workspace @quanstate/web

# ---- runtime ---------------------------------------------------------------
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    QUANSTATE_DATA_DIR=/data \
    QUANSTATE_STT=none \
    QUANSTATE_TRANSLATOR=memory
WORKDIR /app/api
COPY api/pyproject.toml ./
COPY api/quanstate ./quanstate
RUN pip install --no-cache-dir .
COPY --from=webbuild /app/apps/web/dist /app/apps/web/dist
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8000
CMD ["uvicorn", "quanstate.server:app", "--host", "0.0.0.0", "--port", "8000"]
