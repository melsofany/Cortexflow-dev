#!/bin/bash
MODELS=("gemma2:2b" "llama3.2:3b" "mistral:latest")
for MODEL in "${MODELS[@]}"; do
  echo "[$(date '+%H:%M:%S')] Pulling $MODEL..."
  curl -s -X POST http://localhost:11434/api/pull \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"$MODEL\", \"stream\": false}" > /tmp/ollama_pull.log 2>&1
  STATUS=$(cat /tmp/ollama_pull.log | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','done'))" 2>/dev/null || echo "done")
  echo "[$(date '+%H:%M:%S')] $MODEL: $STATUS"
done
echo "All models download complete!"
curl -s http://localhost:11434/api/tags | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('Installed models:')
for m in d.get('models',[]): print('  -', m.get('name'))
"
