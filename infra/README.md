# Pond Tracker infrastructure (Bicep)

Everything Azure-side lives in `main.bicep`:

| Resource | Purpose | Cost note |
|---|---|---|
| Storage account (`Standard_LRS`, StorageV2) + `photos` container | Photo shelf. Phone uploads directly via short-lived user-delegation SAS URLs. | Pennies for a few GB |
| Cosmos DB account (serverless, Session consistency) + `pondtracker` db + `docs` container (`/userId` partition) | Sync store for ponds / catches / feeding logs / settings. | Serverless: pay per request + GB. A single user syncing a phone is cents/month. |
| Static Web App (Free SKU) | Hosts the PWA (`/app`) and the managed Functions API (`/api`). | Free |
| Role assignments | SWA identity -> Cosmos Data Contributor + Storage Blob Data Contributor | - |

Cosmos serverless + Free SWA realistically lands around **cents per month** for one or two users.

## Prerequisites

- Azure CLI 2.60+ (`az version`), logged in: `az login`
- Bicep is bundled with the CLI (`az bicep version`; `az bicep upgrade` if old)
- Contributor + User Access Administrator (or Owner) on the subscription/resource group, since the template creates role assignments

## 1. Deploy

```bash
az group create -n rg-pondtracker -l centralus
az deployment group create -g rg-pondtracker -f infra/main.bicep -p infra/main.bicepparam
```

Capture the outputs:

```bash
az deployment group show -g rg-pondtracker -n main --query properties.outputs -o json
# swaHostname, swaName, cosmosEndpoint, storageAccountName, swaPrincipalId
```

## 2. GitHub secret for the deploy workflow

The workflow in `.github/workflows/azure-static-web-apps.yml` deploys with a deployment token, not SWA's auto-generated workflow.

```bash
az staticwebapp secrets list -n pondtracker-prod -g rg-pondtracker --query properties.apiKey -o tsv
```

Add it to the GitHub repo as **Settings -> Secrets and variables -> Actions -> `AZURE_STATIC_WEB_APPS_API_TOKEN`**, or:

```bash
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN -R SeanCodes2/pond-tracker \
  --body "$(az staticwebapp secrets list -n pondtracker-prod -g rg-pondtracker --query properties.apiKey -o tsv)"
```

## 3. API app settings

`main.bicep` already writes `COSMOS_ENDPOINT`, `COSMOS_DATABASE`, `COSMOS_CONTAINER`, `STORAGE_ACCOUNT_NAME` and `PHOTOS_CONTAINER` into the SWA. To change or add settings by hand:

```bash
az staticwebapp appsettings set -n pondtracker-prod -g rg-pondtracker --setting-names \
  COSMOS_ENDPOINT="https://<cosmos-account>.documents.azure.com:443/" \
  COSMOS_DATABASE=pondtracker \
  COSMOS_CONTAINER=docs \
  STORAGE_ACCOUNT_NAME=<storage-account> \
  PHOTOS_CONTAINER=photos

az staticwebapp appsettings list -n pondtracker-prod -g rg-pondtracker
```

Never set `ALLOW_ANONYMOUS_DEV` in Azure; it is for `func start` on a laptop only.

## 4. Blob CORS (after the first deploy)

The phone PUTs photos straight to Blob Storage, so the storage account must allow the SWA origin. The hostname is only known after deploy, so:

1. Read `swaHostname` from the outputs (e.g. `happy-river-0123abcd.4.azurestaticapps.net`).
2. Add `https://<swaHostname>` to `blobCorsAllowedOrigins` in `main.bicepparam`.
3. Re-run the `az deployment group create` command above.

Or do it directly without re-deploying:

```bash
az storage cors add --services b --methods GET HEAD PUT OPTIONS \
  --origins https://<swaHostname> https://localhost:5173 \
  --allowed-headers '*' --exposed-headers '*' --max-age 3600 \
  --account-name <storage-account> --auth-mode login
```

If you add a custom domain to the SWA, add that origin too.

## 5. Managed identity on the Free SKU

The template enables a system-assigned identity on the SWA and grants it Cosmos DB Built-in Data Contributor (SQL RBAC role `00000000-0000-0000-0000-000000000002`) and Storage Blob Data Contributor. The API code (`api/src/cosmos.ts`, `api/src/functions/photos.ts`) uses `DefaultAzureCredential` and never touches keys; Cosmos is deployed with `disableLocalAuth: true`.

**Caveat:** managed identity for the SWA *managed* Functions backend is a Standard-SKU feature. On Free the deployment usually succeeds but the API's `DefaultAzureCredential` may fail at runtime with "ManagedIdentityCredential authentication unavailable". Options, cheapest first:

1. Upgrade the SWA to Standard (~$9/month): `az staticwebapp update -n pondtracker-prod -g rg-pondtracker --sku Standard`.
2. Stay on Free, set `useManagedIdentity = false` in `main.bicepparam`, flip `disableLocalAuth` to `false` for Cosmos, and add `COSMOS_KEY` / a storage connection string as app settings, then switch the API to key auth. (Code change: pass `key` instead of `aadCredentials` to `CosmosClient`, and use `StorageSharedKeyCredential` for SAS.)
3. Bring your own Functions app (Flex Consumption) linked to the SWA; that app supports managed identity on any SWA tier.

Try option 1 first - the identity + RBAC path is already wired.

## Local development against real Azure

`az login` as a user who has the same two data-plane roles, then `npm run start -w api`. `DefaultAzureCredential` picks up the CLI login. To grant yourself the Cosmos role:

```bash
az cosmosdb sql role assignment create -a <cosmos-account> -g rg-pondtracker \
  --role-definition-id 00000000-0000-0000-0000-000000000002 \
  --principal-id "$(az ad signed-in-user show --query id -o tsv)" \
  --scope "/"
az role assignment create --role "Storage Blob Data Contributor" \
  --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --scope "$(az storage account show -n <storage-account> -g rg-pondtracker --query id -o tsv)"
```

## Tear down

```bash
az group delete -n rg-pondtracker --yes --no-wait
```
