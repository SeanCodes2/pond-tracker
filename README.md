# Pond Tracker

A phone-first, offline-first PWA for logging fish caught from farm ponds, with relative weight (Wr), PSD and cull guidance for bass and bluegill. Your phone owns the data (IndexedDB via Dexie); Azure is only an optional sync point and photo shelf added in Phase 3.

For the full plan, see the **Pond Tracker – Project Plan** in the Claude project.

## Monorepo layout

npm workspaces, one `package-lock.json` at the root.

| Folder | What | Stack |
|---|---|---|
| `shared/` | `@pond-tracker/shared` - domain types and fisheries math (Wr, PSD, cull rules). Pure TS, no DOM. | TypeScript, Vitest |
| `app/` | The PWA. Builds to `app/dist`. | React, Vite, Dexie, vite-plugin-pwa |
| `api/` | Sync + photo API (Phase 3). `POST /api/sync`, `POST /api/photos/upload-url`, `GET /api/photos/{id}`, `GET /api/health`. | Azure Functions v4, Node 20, Cosmos DB, Blob Storage |
| `infra/` | Bicep for Storage + Cosmos (serverless) + Static Web App + RBAC. | Bicep, Azure CLI |
| `.github/workflows/` | Build all workspaces and deploy to Azure Static Web Apps. | GitHub Actions |
| `staticwebapp.config.json` | SWA routing, auth (Entra ID), security headers. Copied into `app/dist` by the workflow. | - |

## Prerequisites

- Node 20+ and npm 10 (`node -v`, `npm -v`)
- Azure CLI (`az`) - only for deploying infra or running the API against real Azure
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) (`func --version` -> 4.x) - only for running the API locally. Install globally (`npm i -g azure-functions-core-tools@4`, winget, or brew); it is intentionally not a repo dependency.

## Quick start (Phase 1: local-only app)

```bash
npm install
npm run dev          # vite --host, prints a LAN URL like http://192.168.1.23:5173
```

Open the LAN URL on your phone (same Wi-Fi). In Chrome on Android: menu -> **Install app** (or **Add to Home screen**). It works offline after the first load; everything is stored on the phone.

Other root scripts:

```bash
npm run build        # shared -> app -> api
npm run typecheck    # all workspaces
npm test             # shared math tests (+ app tests if present)
```

## Local API (Phase 3)

```bash
cp api/local.settings.example.json api/local.settings.json
az login                       # DefaultAzureCredential picks up your CLI login
npm run build -w api
npm run start -w api           # func start on http://localhost:7071
curl http://localhost:7071/api/health
```

- Fill `COSMOS_ENDPOINT` and `STORAGE_ACCOUNT_NAME` in `local.settings.json` from the infra outputs (your `az login` user needs the Cosmos and Blob data roles; see `infra/README.md`).
- `ALLOW_ANONYMOUS_DEV=true` (already set in the example file) makes the API treat unauthenticated requests as user `dev-user`, since the SWA auth header is absent when running `func start` directly. Never set it in Azure.
- To run app + API together behind SWA-style auth and routing, use the SWA CLI: `npx @azure/static-web-apps-cli start http://localhost:5173 --api-location api`.

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Local-only PWA: ponds, catches, Wr/PSD math, cull guidance, photos on-device | In progress |
| 2 | Dashboard: per-pond health, size structure, trends | Planned |
| 3 | Azure sync + photo shelf (this repo's `api/` and `infra/`), Entra ID login via SWA | Skeleton ready |
| 4 | Feeder / feeding-log trends and correlation with condition | Planned |
| 5 | Capacitor wrappers for Play Store / App Store | Planned |

## Deploying

See [`infra/README.md`](infra/README.md): create the resource group, deploy `infra/main.bicep`, set the `AZURE_STATIC_WEB_APPS_API_TOKEN` GitHub secret, then push to `main`. Expected run cost with Cosmos serverless + Free SWA is cents per month.
