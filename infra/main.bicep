// Pond Tracker - data resources for cloud sync (Cosmos DB + photo storage), wired into the
// existing Static Web App.
//
// Deploy: az deployment group create -g rg-pondtracker -f infra/main.bicep -p infra/main.bicepparam
//
// The Static Web App itself (swa-pondtracker) was created separately and is referenced as an
// existing resource. Auth to the data stores is by key: the keys are read inside Azure with
// listKeys() and written straight into the SWA's app settings, so they never appear in
// deployment outputs, the repo, or a terminal.
targetScope = 'resourceGroup'

@description('Azure region for the data resources.')
param location string = resourceGroup().location

@description('Short prefix used to build resource names.')
@minLength(3)
@maxLength(12)
param namePrefix string = 'pondtracker'

@description('Environment label (prod, dev, ...).')
param environment string = 'prod'

@description('Name of the existing Static Web App that hosts the app and API.')
param swaName string = 'swa-pondtracker'

@description('Extra origins allowed to PUT/GET photo blobs via SAS (the SWA hostname is added automatically).')
param extraBlobCorsOrigins array = [
  'http://localhost:5173'
]

var suffix = toLower(uniqueString(resourceGroup().id))
var storageName = take(replace(toLower('${namePrefix}${environment}${suffix}'), '-', ''), 24)
var cosmosName = toLower('${namePrefix}-${environment}-${suffix}')
var tags = {
  app: 'pond-tracker'
  environment: environment
}

resource swa 'Microsoft.Web/staticSites@2023-12-01' existing = {
  name: swaName
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
    allowSharedKeyAccess: true // the API signs SAS URLs with the account key
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
          // The phone PUTs photos straight to blob storage with a short SAS, so the app's
          // origin must be allowed.
          allowedOrigins: concat([ 'https://${swa.properties.defaultHostname}' ], extraBlobCorsOrigins)
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
// Cosmos DB: serverless sync store (pay per request; idle cost ~0)
// ---------------------------------------------------------------------------
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: false // key auth from the SWA-managed API (Free tier has no managed identity)
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
        // Sync pulls are "userId = X AND serverUpdatedAt > since ORDER BY serverUpdatedAt".
        compositeIndexes: [
          [
            {
              path: '/userId'
              order: 'ascending'
            }
            {
              path: '/serverUpdatedAt'
              order: 'ascending'
            }
          ]
        ]
      }
    }
  }
}

// ---------------------------------------------------------------------------
// App settings the managed API reads (api/local.settings.example.json mirrors these).
// Note: this replaces the SWA's whole app-settings set.
// ---------------------------------------------------------------------------
resource swaSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    COSMOS_ENDPOINT: cosmos.properties.documentEndpoint
    COSMOS_KEY: cosmos.listKeys().primaryMasterKey
    COSMOS_DATABASE: cosmosDb.name
    COSMOS_CONTAINER: docsContainer.name
    STORAGE_ACCOUNT_NAME: storage.name
    STORAGE_ACCOUNT_KEY: storage.listKeys().keys[0].value
    PHOTOS_CONTAINER: photosContainer.name
  }
}

// ---------------------------------------------------------------------------
// Outputs (no secrets)
// ---------------------------------------------------------------------------
output swaHostname string = swa.properties.defaultHostname
output cosmosAccountName string = cosmos.name
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output storageAccountName string = storage.name
