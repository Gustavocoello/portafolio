FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY archivos.py files_server.py ./
ENV PYTHONUNBUFFERED=1
CMD ["python", "files_server.py"]
