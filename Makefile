.PHONY: help test test-sdk test-wizard test-live typecheck lint build

help:
	@echo "Available targets:"
	@echo "  make test         Run every SDK repo test surface"
	@echo "  make test-sdk     Run SDK mocked tests"
	@echo "  make test-wizard  Run wizard mocked tests"
	@echo "  make test-live    Run SDK live tests"
	@echo "  make typecheck    Typecheck SDK and wizard"
	@echo "  make lint         Lint SDK and wizard"
	@echo "  make build        Build SDK and wizard"

test: test-sdk test-wizard test-live

test-sdk:
	npm test

test-wizard:
	cd packages/wizard && npm test

test-live:
	npm run test:live

typecheck:
	npm run typecheck
	cd packages/wizard && npm run typecheck

lint:
	npm run lint
	cd packages/wizard && npm run lint

build:
	npm run build
	cd packages/wizard && npm run build
