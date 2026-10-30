import { CosmosClient, type Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { requireEnv } from './http';

let client: CosmosClient | undefined;
let container: Container | undefined;

/**
 * Lazy singleton Cosmos client.
 * Auth is DefaultAzureCredential: managed identity in Azure, `az login` locally.
 * The account is deployed with disableLocalAuth=true, so keys are never used.
 * Partition key for the `docs` container is /userId.
 */
export function getCosmosClient(): CosmosClient {
  if (!client) {
    client = new CosmosClient({
      endpoint: requireEnv('COSMOS_ENDPOINT'),
      aadCredentials: new DefaultAzureCredential(),
    });
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
