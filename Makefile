.PHONY: help setup build test test-sdk test-wizard test-live lint fmt typecheck clean

# Canonical day-to-day verbs (setup / build / test / lint / fmt / clean)
# mirror the same surface used in sibling repos. The sub-targets (test-sdk,
# test-wizard, test-live, typecheck) are the underlying steps the top-level
# verbs delegate into and stay available individually.

help:
	@echo "Day-to-day:"
	@echo "  make setup     Install root deps and the wizard package's deps"
	@echo "  make build     Build the SDK and the wizard"
	@echo "  make test      Run every test surface (mocked SDK + wizard + live, where credentials allow)"
	@echo "  make lint      Lint the SDK and the wizard"
	@echo "  make fmt       Format the SDK and the wizard with Prettier"
	@echo "  make clean     Remove build artifacts (dist/, packages/wizard/dist/)"
	@echo ""
	@echo "Sub-targets:"
	@echo "  make test-sdk     SDK mocked unit + integration tests"
	@echo "  make test-wizard  Wizard mocked tests"
	@echo "  make test-live    SDK live tests (skips cleanly without credentials)"
	@echo "  make typecheck    tsc --noEmit on the SDK and the wizard"

setup:
	npm install
	cd packages/wizard && npm install

build:
	npm run build
	cd packages/wizard && npm run build

# `test` runs the entire test surface in one shot. test-live skips cleanly
# without UNDERSCORE_PUBLISHABLE_KEY / UNDERSCORE_SECRET_KEY, so this is
# safe on a fresh checkout and gives true "all tests" semantics.
test: test-sdk test-wizard test-live

test-sdk:
	npm test

test-wizard:
	cd packages/wizard && npm test

test-live:
	npm run test:live

lint:
	npm run lint
	cd packages/wizard && npm run lint

fmt:
	npx prettier --write .

typecheck:
	npm run typecheck
	cd packages/wizard && npm run typecheck

clean:
	rm -rf dist/
	rm -rf packages/wizard/dist/
