using './main.bicep'

param namePrefix = 'pondtracker'
param environment = 'prod'
param swaName = 'swa-pondtracker'
param extraBlobCorsOrigins = [
  'http://localhost:5173'
]
