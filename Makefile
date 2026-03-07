.DEFAULT_GOAL := help
.PHONY: help

help:
	@echo "Makefile is deprecated. Use 'just <recipe>' instead."
	@just --list

%:
	@echo "Makefile is deprecated. Forwarding to 'just $@'."
	@just $@
