import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  type UserDelegationKey,
} from '@azure/storage-blob';
import { randomUUID } from 'node:crypto';
import { getUser } from '../auth';
import { HttpError, json, requireEnv, toErrorResponse } from '../http';

const SAS_TTL_MS = 15 * 60 * 1000;
const PHOTO_ID_RE = /^[0-9a-f-]{36}$/i;

let blobService: BlobServiceClient | undefined;

function getBlobService(): BlobServiceClient {
  if (!blobService) {
    const account = requireEnv('STORAGE_ACCOUNT_NAME');
    blobService = new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
  }
  return blobService;
}

function photosContainerName(): string {
  return process.env.PHOTOS_CONTAINER ?? 'photos';
}

/**
 * Build a user-delegation SAS URL for one blob. Requires the caller's identity
 * to hold Storage Blob Data Contributor (or Delegator) on the account.
 */
async function blobSasUrl(
  blobName: string,
  permissions: string,
  contentType?: string,
): Promise<{ url: string; expiresOn: Date }> {
  const service = getBlobService();
  const startsOn = new Date(Date.now() - 5 * 60 * 1000); // clock skew allowance
  const expiresOn = new Date(Date.now() + SAS_TTL_MS);
  const key: UserDelegationKey = await service.getUserDelegationKey(startsOn, expiresOn);
  const containerName = photosContainerName();
  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse(permissions),
      startsOn,
      expiresOn,
      ...(contentType ? { contentType } : {}),
    },
    key,
    service.accountName,
  ).toString();
  const blobUrl = service.getContainerClient(containerName).getBlobClient(blobName).url;
  return { url: `${blobUrl}?${sas}`, expiresOn };
}

interface UploadUrlRequest {
  catchId?: unknown;
  contentType?: unknown;
}

async function uploadUrlHandler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = getUser(req);
    const body = (await req.json()) as UploadUrlRequest;
    if (typeof body.catchId !== 'string' || body.catchId.length === 0) {
      throw new HttpError(400, '`catchId` is required');
    }
    const contentType = typeof body.contentType === 'string' ? body.contentType : 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      throw new HttpError(400, '`contentType` must be an image/* type');
    }

    const photoId = randomUUID();
    const blobName = `${user.userId}/${photoId}.jpg`;
    const { url, expiresOn } = await blobSasUrl(blobName, 'cw', contentType);
    context.info(`photos: upload-url user=${user.userId} catch=${body.catchId} photo=${photoId}`);
    return json({ photoId, blobName, sasUrl: url, expiresOn: expiresOn.toISOString() });
  } catch (err) {
    return toErrorResponse(err, context);
  }
}

async function getPhotoHandler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = getUser(req);
    const photoId = req.params['photoId'] ?? '';
    if (!PHOTO_ID_RE.test(photoId)) {
      throw new HttpError(400, 'Invalid photoId');
    }
    // Blob path is scoped to the caller's userId, so a user can only ever
    // reach their own photos regardless of the id they pass.
    const blobName = `${user.userId}/${photoId}.jpg`;
    const exists = await getBlobService()
      .getContainerClient(photosContainerName())
      .getBlobClient(blobName)
      .exists();
    if (!exists) {
      throw new HttpError(404, 'Photo not found');
    }
    const { url } = await blobSasUrl(blobName, 'r');
    return { status: 302, headers: { location: url, 'cache-control': 'private, max-age=0' } };
  } catch (err) {
    return toErrorResponse(err, context);
  }
}

app.http('photosUploadUrl', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'photos/upload-url',
  handler: uploadUrlHandler,
});

app.http('photosGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'photos/{photoId}',
  handler: getPhotoHandler,
});
