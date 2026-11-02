# Repository layout

```text
.
├── .agents/skills/                 # Guidance for coding agents
├── apps/                          # App defaults and lifecycle scripts
│   ├── <app>/
│   │   ├── config/                # Native defaults and templates
│   │   ├── scripts/               # Optional lifecycle hooks
│   │   ├── tests/                 # Optional app tests
│   │   ├── app.jsonc              # Manifest for an indexed app
│   │   └── README.md              # Optional app usage
│   ├── apps.jsonc                 # Selected manifests in configuration order
│   ├── app.example.jsonc          # Documented manifest example
│   └── README.md
├── install.sh                     # Prepare the checkout and install the CLI
├── installs/                      # Package and web app recipe lists
│   ├── packages.jsonc              # Packages grouped by installation stage
│   ├── packages.mise.jsonc         # Development tools and runtimes
│   ├── packages.webapp.jsonc       # Desktop web apps
│   ├── example.jsonc              # Documented package recipe examples
│   └── README.md
├── packages/
│   └── luna-api/                  # Shared Luna APIs for Bun
├── src/
│   ├── luna-cli/                  # The luna command-line interface
│   ├── luna-login/                # Login screen
│   ├── luna-menu/                 # Application launcher
│   ├── luna-polkit/               # Authentication prompts
│   └── luna-wallpaper/            # Wallpaper renderer
├── __tests__/                     # Repository-level Bun tests and fixtures
├── themes/
│   ├── bundled/                   # Included themes
│   ├── DOCS.md                    # Theme format and behavior
│   └── README.md
├── .gitignore
├── AGENTS.md                      # Repository policy
├── ARCH.md                        # This overview
├── bun.lock                       # Locked Bun dependencies
├── mise.toml                      # Build and install tasks
├── package.json                   # Bun workspace and checks
├── TODO.md
└── README.md
```

Only apps listed in `apps/apps.jsonc` use the JSONC manifest layout above.
The unlisted Luna desktop apps still have `app.conf` manifests.
