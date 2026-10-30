import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import { randomUUID } from 'node:crypto';
import { getUser } from '../auth';
import { HttpError, json, requireEnv, toErrorResponse } from '../http';

const SAS_TTL_MS = 15 * 60 * 1000;
const PHOTO_ID_RE = /^[0-9a-f-]{36}$/i;

let blobService: BlobServiceClient | undefined;
let sharedKey: StorageSharedKeyCredential | undefined;

/**
 * Auth: STORAGE_ACCOUNT_KEY when set (SWA Free tier), otherwise DefaultAzureCredential
 * (managed identity / az login) with user-delegation SAS.
 */
function getBlobService(): BlobServiceClient {
  if (!blobService) {
    const account = requireEnv('STORAGE_ACCOUNT_NAME');
    const key = process.env.STORAGE_ACCOUNT_KEY;
    const url = `https://${account}.blob.core.windows.net`;
    if (key) {
      sharedKey = new StorageSharedKeyCredential(account, key);
      blobService = new BlobServiceClient(url, sharedKey);
    } else {
      blobService = new BlobServiceClient(url, new DefaultAzureCredential());
    }
  }
  return blobService;
}

function photosContainerName(): string {
  return process.env.PHOTOS_CONTAINER ?? 'photos';
}

/**
 * Build a short-lived SAS URL for one blob: signed with the account key when configured,
 * otherwise a user-delegation SAS (identity needs Storage Blob Data Contributor).
 */
async function blobSasUrl(
  blobName: string,
  permissions: string,
  contentType?: string,
): Promise<{ url: string; expiresOn: Date }> {
  const service = getBlobService();
  const startsOn = new Date(Date.now() - 5 * 60 * 1000); // clock skew allowance
  const expiresOn = new Date(Date.now() + SAS_TTL_MS);
  const containerName = photosContainerName();
  const values = {
    containerName,
    blobName,
    permissions: BlobSASPermissions.parse(permissions),
    startsOn,
    expiresOn,
    ...(contentType ? { contentType } : {}),
  };
  const sas = sharedKey
    ? generateBlobSASQueryParameters(values, sharedKey).toString()
    : generateBlobSASQueryParameters(values, await service.getUserDelegationKey(startsOn, expiresOn), service.accountName).toString();
  const blobUrl = service.getContainerClient(containerName).getBlobClient(blobName).url;
  return { url: `${blobUrl}?${sas}`, expiresOn };
}

interface UploadUrlRequest {
  catchId?: unknown;
  contentType?: unknown;
  /** Optional client-generated UUID so the photo keeps the same id on device and in the cloud. */
  photoId?: unknown;
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

    if (body.photoId !== undefined && (typeof body.photoId !== 'string' || !PHOTO_ID_RE.test(body.photoId))) {
      throw new HttpError(400, '`photoId` must be a UUID');
    }
    const photoId = typeof body.photoId === 'string' ? body.photoId.toLowerCase() : randomUUID();
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
