#!/bin/bash
set -e

echo "=== Starting Ollama Server ==="
ollama serve &
OLLAMA_PID=$!

echo "=== Waiting for Ollama to be ready ==="
for i in $(seq 1 30); do
    if ollama list >/dev/null 2>&1; then
        echo "Ollama is ready!"
        break
    fi
    echo "Attempt $i/30 - waiting..."
    sleep 2
done

echo "=== Pulling AI Model Weights ==="

MODELS=(
    "qwen2:0.5b"
    "qwen2.5:0.5b"
    "llama3.2:1b"
    "phi3:mini"
    "gemma2:2b"
    "llama3.2:3b"
    "mistral:latest"
)

for MODEL in "${MODELS[@]}"; do
    if ollama list 2>/dev/null | grep -q "$(echo $MODEL | cut -d: -f1)"; then
        echo "✓ Model $MODEL already exists, skipping..."
    else
        echo "↓ Pulling model: $MODEL"
        ollama pull "$MODEL" && echo "✓ $MODEL downloaded successfully" || echo "✗ Failed to pull $MODEL, continuing..."
    fi
done

echo "=== All models ready ==="
ollama list

wait $OLLAMA_PID
