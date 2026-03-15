#!/bin/bash
set -e

export FLYCTL_INSTALL="/home/runner/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

check_auth() {
    log_info "Checking Fly.io authentication..."
    if ! flyctl auth whoami &>/dev/null; then
        log_error "Not authenticated with Fly.io. Please set FLY_API_TOKEN or run 'flyctl auth login'"
    fi
    FLYUSER=$(flyctl auth whoami 2>/dev/null)
    log_success "Authenticated as: $FLYUSER"
}

create_app() {
    local APP_NAME=$1
    local REGION=${2:-iad}
    if flyctl apps list 2>/dev/null | grep -q "^$APP_NAME"; then
        log_warn "App $APP_NAME already exists, skipping creation"
    else
        log_info "Creating app: $APP_NAME in region $REGION"
        flyctl apps create "$APP_NAME" --org personal 2>/dev/null || log_warn "Could not create $APP_NAME (may already exist)"
    fi
}

setup_database() {
    log_info "=== Setting up PostgreSQL Database ==="
    DB_NAME="cortexflow-db"
    
    if flyctl postgres list 2>/dev/null | grep -q "$DB_NAME"; then
        log_warn "Database $DB_NAME already exists"
    else
        log_info "Creating PostgreSQL database cluster..."
        flyctl postgres create \
            --name "$DB_NAME" \
            --region iad \
            --vm-size shared-cpu-1x \
            --volume-size 10 \
            --initial-cluster-size 1 \
            --org personal
        log_success "Database $DB_NAME created"
    fi

    log_info "Attaching database to cortexflow-api..."
    flyctl postgres attach "$DB_NAME" --app cortexflow-api 2>/dev/null || log_warn "Database may already be attached"
    log_success "Database attached to cortexflow-api"
}

setup_redis() {
    log_info "=== Setting up Redis (Memory Cache) ==="
    REDIS_NAME="cortexflow-redis"
    
    if flyctl redis list 2>/dev/null | grep -q "$REDIS_NAME"; then
        log_warn "Redis $REDIS_NAME already exists"
    else
        log_info "Creating Redis instance for memory/caching..."
        flyctl redis create \
            --name "$REDIS_NAME" \
            --region iad \
            --no-replicas \
            --org personal
        log_success "Redis $REDIS_NAME created"
    fi

    REDIS_URL=$(flyctl redis status "$REDIS_NAME" --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('privateUrl',''))" 2>/dev/null || echo "")
    
    if [ -n "$REDIS_URL" ]; then
        log_info "Setting REDIS_URL for cortexflow-api..."
        flyctl secrets set REDIS_URL="$REDIS_URL" --app cortexflow-api
        flyctl secrets set REDIS_URL="$REDIS_URL" --app cortexflow-agent
        log_success "Redis URL configured"
    fi
}

setup_secrets() {
    local APP=$1
    log_info "Setting secrets for $APP..."
    
    if [ -n "$DEEPSEEK_API_KEY" ]; then
        flyctl secrets set DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" --app "$APP"
    fi
}

deploy_ollama() {
    log_info "=== Deploying Ollama AI Server ==="
    
    flyctl volumes create cortexflow_ollama_models \
        --app cortexflow-ollama \
        --region iad \
        --size 50 2>/dev/null || log_warn "Volume may already exist"

    flyctl deploy \
        --app cortexflow-ollama \
        --config fly/ollama/fly.toml \
        --dockerfile fly/ollama/Dockerfile \
        --remote-only \
        --wait-timeout 600

    log_success "Ollama deployed. Model weights will download on first startup."
}

deploy_agent_service() {
    log_info "=== Deploying Python Agent Service ==="
    
    setup_secrets cortexflow-agent
    
    flyctl deploy \
        --app cortexflow-agent \
        --config fly/agent-service/fly.toml \
        --dockerfile fly/agent-service/Dockerfile \
        --remote-only \
        --wait-timeout 300

    log_success "Agent Service deployed"
}

deploy_api_server() {
    log_info "=== Deploying Node.js API Server ==="

    flyctl volumes create cortexflow_api_data \
        --app cortexflow-api \
        --region iad \
        --size 5 2>/dev/null || log_warn "Volume may already exist"

    setup_secrets cortexflow-api

    flyctl deploy \
        --app cortexflow-api \
        --config fly/api-server/fly.toml \
        --dockerfile fly/api-server/Dockerfile \
        --remote-only \
        --wait-timeout 300

    log_success "API Server deployed"
}

deploy_frontend() {
    log_info "=== Deploying React Frontend ==="

    API_URL=$(flyctl status --app cortexflow-api --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('https://' + d.get('Hostname','cortexflow-api.fly.dev'))" 2>/dev/null || echo "https://cortexflow-api.fly.dev")
    
    flyctl secrets set VITE_API_URL="$API_URL" --app cortexflow-web 2>/dev/null || true

    flyctl deploy \
        --app cortexflow-web \
        --config fly/cortexflow/fly.toml \
        --dockerfile fly/cortexflow/Dockerfile \
        --remote-only \
        --wait-timeout 300

    log_success "Frontend deployed"
}

main() {
    log_info "======================================"
    log_info "   CortexFlow - Fly.io Deployment     "
    log_info "======================================"

    check_auth

    log_info "=== Creating Applications ==="
    create_app cortexflow-ollama iad
    create_app cortexflow-agent iad
    create_app cortexflow-api iad
    create_app cortexflow-web iad

    setup_database
    setup_redis

    deploy_ollama
    deploy_agent_service
    deploy_api_server
    deploy_frontend

    log_info "======================================"
    log_success "Deployment Complete!"
    log_info "======================================"
    echo ""
    echo "  Frontend:      https://cortexflow-web.fly.dev"
    echo "  API Server:    https://cortexflow-api.fly.dev"
    echo "  Agent Service: https://cortexflow-agent.fly.dev (internal)"
    echo "  Ollama:        https://cortexflow-ollama.fly.dev (internal)"
    echo ""
    log_info "AI models (qwen2:0.5b, qwen2.5:0.5b, llama3.2:1b, llama3.2:3b,"
    log_info "           gemma2:2b, phi3:mini, mistral:latest) will download"
    log_info "automatically on the Ollama server first startup."
    echo ""
}

main "$@"
