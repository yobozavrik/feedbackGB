FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker.py bootstrap.py config.py ./
RUN mkdir -p /data && chmod 700 /data
ENV TELEGRAM_SESSION_PATH=/data/utility-account
CMD ["python", "worker.py"]
