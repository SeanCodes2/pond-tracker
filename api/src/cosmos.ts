import { CosmosClient, type Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { requireEnv } from './http';

let client: CosmosClient | undefined;
let container: Container | undefined;

/**
 * Lazy singleton Cosmos client.
 * Auth: COSMOS_KEY when set (SWA Free tier, key stored in app settings), otherwise
 * DefaultAzureCredential (managed identity on SWA Standard, `az login` locally).
 * Partition key for the `docs` container is /userId.
 */
export function getCosmosClient(): CosmosClient {
  if (!client) {
    const endpoint = requireEnv('COSMOS_ENDPOINT');
    const key = process.env.COSMOS_KEY;
    client = key ? new CosmosClient({ endpoint, key }) : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  }
  return client;
}

export function getDocsContainer(): Container {
  if (!container) {
    const database = process.env.COSMOS_DATABASE ?? 'pondtracker';
    const containerId = process.env.COSMOS_CONTAINER ?? 'docs';
    container = getCosmosClient().database(database).container(containerId);
  }
  return container;
}
