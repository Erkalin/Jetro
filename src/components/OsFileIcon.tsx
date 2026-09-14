import { useEffect, useState } from 'react';
import type { Item } from '@/types';
import { hasBackend, iconCache, iconCacheKey } from '@/api/jetro';
import CategoryIcon from '@/components/CategoryIcon';

export default function OsFileIcon({ item }: { item: Item }) {
  const key = iconCacheKey(item.savePath, item.filename);
  const [src, setSrc] = useState<string | null>(() => iconCache.get(key) ?? null);
  const [miss, setMiss] = useState(() => !iconCache.has(key));
  useEffect(() => {
    if (!miss) return;
    let alive = true;
    if (!hasBackend()) return;
    window
      .jetro!.getFileIcon(item.savePath, item.filename)
      .then((d) => {
        iconCache.set(key, d);
        if (alive) {
          setSrc(d);
          setMiss(false);
        }
      })
      .catch(() => {
        iconCache.set(key, null);
        if (alive) setMiss(false);
      });
    return () => {
      alive = false;
    };
  }, [key, miss, item.savePath, item.filename]);
  if (src) {
    return (
      <div className="file-icon">
        <img src={src} alt="" draggable={false} />
      </div>
    );
  }
  return <div className="file-icon"><CategoryIcon cat={item.category} /></div>;
}
