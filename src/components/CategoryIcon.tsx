import { FiArchive, FiBox, FiCpu, FiFileText, FiFilm, FiMusic } from 'react-icons/fi';

export default function CategoryIcon({ cat, size = 20 }: { cat: string; size?: number }) {
  const map: Record<string, typeof FiBox> = {
    video: FiFilm,
    audio: FiMusic,
    compressed: FiArchive,
    document: FiFileText,
    program: FiCpu,
    other: FiBox,
  };
  const Icon = map[cat] || FiBox;
  return <Icon size={size} className="file-fallback-icon" />;
}
