// Pond Tracker - Azure infrastructure
// Deploy: az deployment group create -g rg-pondtracker -f infra/main.bicep -p infra/main.bicepparam
targetScope = 'resourceGroup'

@description('Azure region for all resources. Static Web Apps are deployed to a fixed set of regions; see swaLocation.')
param location string = resourceGroup().location

@description('Short prefix used to build resource names.')
@minLength(3)
@maxLength(12)
param namePrefix string = 'pondtracker'

@description('Environment label (prod, dev, ...).')
param environment string = 'prod'

@description('GitHub repository that the Static Web App builds from.')
param repositoryUrl string = 'https://github.com/SeanCodes2/pond-tracker'

@description('Branch the Static Web App tracks.')
param branch string = 'main'

@description('Static Web Apps are only available in a handful of regions. Defaults to a SWA-supported region; keep it near `location`.')
@allowed([
  'centralus'
  'eastus2'
  'eastasia'
  'westeurope'
  'westus2'
])
param swaLocation string = 'centralus'

@description('Origins allowed to PUT/GET photo blobs directly via SAS URLs. Add the SWA hostname (https://<swaHostname>) after the first deploy.')
param blobCorsAllowedOrigins array = [
  'https://localhost:5173'
]

@description('''
Grant the Static Web App's system-assigned managed identity data-plane access to Cosmos DB and Blob Storage.
NOTE: managed identity on the SWA-managed Functions backend is only supported on the Standard SKU. On the Free SKU
the identity resource may deploy but the managed API cannot use it; set this to false and instead configure
COSMOS_KEY / STORAGE_CONNECTION_STRING app settings (and adjust api/src/cosmos.ts + photos.ts accordingly),
or upgrade the SWA to Standard.
''')
param useManagedIdentity bool = true

var suffix = toLower(uniqueString(resourceGroup().id))
var storageName = take(replace(toLower('${namePrefix}${environment}${suffix}'), '-', ''), 24)
var cosmosName = toLower('${namePrefix}-${environment}-${suffix}')
var swaName = toLower('${namePrefix}-${environment}')
var tags = {
  app: 'pond-tracker'
  environment: environment
}

// ---------------------------------------------------------------------------
// Storage account: photo shelf
// ---------------------------------------------------------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  // namePrefix has @minLength(3) and uniqueString() is always 13 chars, so take(.., 24) is never short.
  #disable-next-line BCP334
  name: storageName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true // user-delegation SAS does not need keys; leave on for az CLI convenience
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: blobCorsAllowedOrigins
          allowedMethods: [
            'GET'
            'HEAD'
            'PUT'
            'OPTIONS'
          ]
          allowedHeaders: [
            '*'
          ]
          exposedHeaders: [
            '*'
          ]
          maxAgeInSeconds: 3600
        }
      ]
    }
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource photosContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'photos'
  properties: {
    publicAccess: 'None'
  }
}

// ---------------------------------------------------------------------------
// Cosmos DB: serverless sync store
// ---------------------------------------------------------------------------
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true
    enableAutomaticFailover: false
    enableMultipleWriteLocations: false
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    backupPolicy: {
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 1440
        backupRetentionIntervalInHours: 168
        backupStorageRedundancy: 'Local'
      }
    }
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'pondtracker'
  properties: {
    resource: {
      id: 'pondtracker'
    }
  }
}

resource docsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'docs'
  properties: {
    resource: {
      id: 'docs'
      partitionKey: {
        paths: [
          '/userId'
        ]
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/*'
          }
        ]
        excludedPaths: [
          {
            path: '/"_etag"/?'
          }
        ]
        compositeIndexes: [
          [
            {
              path: '/userId'
              order: 'ascending'
            }
            {
              path: '/updatedAt'
              order: 'ascending'
            }
          ]
        ]
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Static Web App: hosts /app (static) + /api (managed Functions)
// ---------------------------------------------------------------------------
resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: swaName
  location: swaLocation
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    repositoryUrl: repositoryUrl
    branch: branch
    // We deploy via the GitHub Actions workflow with the deployment token, not SWA's auto-generated workflow.
    provider: 'GitHub'
    buildProperties: {
      appLocation: 'app'
      apiLocation: 'api'
      outputLocation: 'dist'
      skipGithubActionWorkflowGeneration: true
    }
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

// App settings the managed API reads (api/local.settings.example.json mirrors these).
resource swaSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    COSMOS_ENDPOINT: cosmos.properties.documentEndpoint
    COSMOS_DATABASE: cosmosDb.name
    COSMOS_CONTAINER: docsContainer.name
    STORAGE_ACCOUNT_NAME: storage.name
    PHOTOS_CONTAINER: photosContainer.name
  }
}

// ---------------------------------------------------------------------------
// Role assignments: SWA managed identity -> data planes
// ---------------------------------------------------------------------------

// Cosmos DB Built-in Data Contributor (SQL RBAC, not ARM RBAC)
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = if (useManagedIdentity) {
  parent: cosmos
  name: guid(cosmos.id, swa.id, cosmosDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    principalId: swa.identity.principalId
    scope: cosmos.id
  }
}

// Storage Blob Data Contributor (ARM RBAC) - needed for getUserDelegationKey + blob exists checks
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource storageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (useManagedIdentity) {
  name: guid(storage.id, swa.id, storageBlobDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: swa.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output swaHostname string = swa.properties.defaultHostname
output swaName string = swa.name
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output storageAccountName string = storage.name
output swaPrincipalId string = swa.identity.principalId
