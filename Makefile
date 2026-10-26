.PHONY: install api web build test test-api test-sdk typecheck bench docker

install:
	pip install -e "api[dev]"
	npm ci

api:
	cd api && uvicorn quanstate.server:app --reload --port 8000

web:
	npm run dev:web

services:
	npm run build --workspace @quanstate/services

build: services
	npm run build

test: test-api test-sdk

test-api:
	cd api && pytest -q

test-sdk:
	npm run test --workspace @quanstate/services

typecheck:
	npm run typecheck

bench:
	cd api && pytest tests/test_live_latency.py -q -s

docker:
	docker compose up --build
