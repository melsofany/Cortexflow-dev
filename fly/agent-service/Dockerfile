FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY artifacts/agent-service/requirements.txt ./requirements.txt
COPY artifacts/agent-service/main.py ./main.py

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8090

ENV AGENT_SERVICE_PORT=8090

CMD ["python", "main.py"]
