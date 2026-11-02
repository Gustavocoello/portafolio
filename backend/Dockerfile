FROM python:3.11-slim

# libpq-dev + gcc: psycopg2 se compila; libmagic1: detecta el tipo de los archivos subidos
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV PYTHONUNBUFFERED=1 PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'"]
