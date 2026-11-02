#!/usr/bin/env bash
# Set the user's default branch and editor after installing Git.
# Steps:
# 1. Use Git's global config writer to set init.defaultBranch to master.
# 2. Set core.editor to nvim for Git's commit messages and other editing tasks.
# Git selects the configuration file and updates these settings. Safe to rerun.

set -euo pipefail

git config --global init.defaultBranch master
git config --global core.editor nvim
