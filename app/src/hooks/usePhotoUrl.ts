import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db/db';

/** Object URL for a stored photo, revoked on change/unmount. */
export function usePhotoUrl(photoId: string | undefined): string | undefined {
  const photo = useLiveQuery(async () => (photoId ? db.photos.get(photoId) : undefined), [photoId]);
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!photo) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return url;
}
