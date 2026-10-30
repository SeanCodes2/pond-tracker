import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { accessCheckDisabled } from '../lib/access';

/**
 * URL for a stored photo: an object URL for a local blob (revoked on change/unmount), or for a
 * photo pulled from the cloud without its blob, the API route that redirects to a short read SAS.
 */
export function usePhotoUrl(photoId: string | undefined): string | undefined {
  const photo = useLiveQuery(async () => (photoId ? db.photos.get(photoId) : undefined), [photoId]);
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!photo) {
      setUrl(undefined);
      return;
    }
    if (!photo.blob) {
      // No /api in local dev.
      setUrl(accessCheckDisabled() ? undefined : `/api/photos/${encodeURIComponent(photo.id)}`);
      return;
    }
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return url;
}
