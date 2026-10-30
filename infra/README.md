# Infrastructure

`main.bicep` creates the cloud-sync data stores and wires them into the existing Static Web App:

| Resource | Purpose | Cost at one-user scale |
| --- | --- | --- |
| Cosmos DB (serverless) `pondtracker-prod-<suffix>`, database `pondtracker`, container `docs` (partition `/userId`) | Synced ponds, catches, feeder logs, settings, photo metadata | Cents per month (pay per request) |
| Storage account `pondtrackerprod<suffix>`, container `photos` | Photo files, uploaded by the phone with short-lived SAS URLs | Cents per month |
| App settings on `swa-pondtracker` | Endpoints and keys the API reads | Free |

The Static Web App (`swa-pondtracker`, Free tier) was created in the portal and is referenced as `existing`. The GitHub workflow deploys the app and API to it.

## Deploy

```powershell
az login --tenant eaa74a22-00dd-4767-892d-27a5847a490c
az account set -s 254e7e9c-0071-43d2-ac88-2b40fcaf5a02
az deployment group create -g rg-pondtracker -f infra/main.bicep -p infra/main.bicepparam
```

Takes a few minutes (Cosmos is the slow one). Safe to re-run: it updates in place.

## How auth works (keys, Free tier)

- The template reads the Cosmos and Storage keys **inside Azure** with `listKeys()` and writes them into the SWA app settings (`COSMOS_KEY`, `STORAGE_ACCOUNT_KEY`). They never appear in outputs, the repo or your terminal.
- The API (`api/src/cosmos.ts`, `api/src/functions/photos.ts`) uses the keys when present, otherwise falls back to `DefaultAzureCredential`.
- The phone never sees a key: it gets a 15-minute, single-blob SAS URL from `/api/photos/upload-url` and uploads straight to storage. Blob CORS allows the SWA hostname automatically.
- `/api/*` requires the `angler` role (see `staticwebapp.config.json`), and every record is partitioned by the signed-in user's id.

**Rotating a key:** regenerate it in the portal (Cosmos → Keys, or Storage → Access keys), then re-run the deploy command to push the new value into the app settings.

**Moving to managed identity later:** upgrade the SWA to Standard, enable its system-assigned identity, grant it *Cosmos DB Built-in Data Contributor* (SQL role `00000000-0000-0000-0000-000000000002`) and *Storage Blob Data Contributor*, remove `COSMOS_KEY` / `STORAGE_ACCOUNT_KEY` from the app settings, and set Cosmos `disableLocalAuth: true`. No code changes or data migration needed.

## Local API

```powershell
cp api/local.settings.example.json api/local.settings.json
# fill COSMOS_ENDPOINT, COSMOS_KEY, STORAGE_ACCOUNT_NAME, STORAGE_ACCOUNT_KEY (portal → Keys)
# and set ALLOW_ANONYMOUS_DEV=true to skip SWA auth locally
npm run start -w api
```

`local.settings.json` is gitignored.
