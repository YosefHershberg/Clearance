FROM python:3.12-slim AS builder

WORKDIR /build
COPY requirements.txt .
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -U pip \
 && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim AS runtime

# System deps for matplotlib (Agg backend needs libfreetype + libpng) and
# DejaVu fonts so labels render consistently across environments.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libfreetype6 libpng16-16 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1001 app
WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UPLOADS_PARENT_DIR=/data

COPY app/ ./app/

USER app
EXPOSE 3002
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3002"]
