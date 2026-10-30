using './main.bicep'

param namePrefix = 'pondtracker'
param environment = 'prod'
param repositoryUrl = 'https://github.com/SeanCodes2/pond-tracker'
param branch = 'main'
param swaLocation = 'centralus'

// Add 'https://<swaHostname>' here after the first deploy and re-run the deployment.
param blobCorsAllowedOrigins = [
  'https://localhost:5173'
]

// Set to false on Free SKU if the managed API cannot use the identity (see README).
param useManagedIdentity = true
