# Public-photo classifier (F-15 R-15.10, #26): NudeNet (MIT) on CPU, private Fly network only.
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1
WORKDIR /app
# Build context: repository root (flyctl deploy runs from there).
COPY infra/classifier/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY infra/classifier/server.py .
USER nobody
EXPOSE 8080
CMD ["python", "server.py"]
