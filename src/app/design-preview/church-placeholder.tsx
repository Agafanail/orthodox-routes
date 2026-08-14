import type { CSSProperties } from 'react';

type ChurchPlaceholderProps = {
  churchId: string;
  compact?: boolean;
  className?: string;
};

const palettes = [
  { background: '#E6EBEF', drum: '#CFD9E1', dome: '#AEBCC9' },
  { background: '#E7EDE8', drum: '#D0DCD1', dome: '#AFC1B3' },
  { background: '#EFEAE0', drum: '#DCD3C2', dome: '#C4B7A0' },
] as const;

function paletteIndex(churchId: string) {
  let hash = 0;
  for (const character of churchId) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return hash % palettes.length;
}

export function ChurchPlaceholder({ churchId, compact = false, className }: ChurchPlaceholderProps) {
  const palette = palettes[paletteIndex(churchId)];
  const style = {
    '--ph-bg': palette.background,
    '--ph-drum': palette.drum,
    '--ph-dome': palette.dome,
  } as CSSProperties;

  return (
    <div className={className} style={style} data-placeholder-palette={paletteIndex(churchId) + 1}>
      <svg
        viewBox="0 0 240 200"
        preserveAspectRatio="xMidYMax meet"
        role="img"
        aria-label="Фотография храма не загружена"
      >
        <rect width="240" height="200" fill="var(--ph-bg)" />
        <rect x="64" y="132" width="112" height="68" fill="var(--ph-drum)" />
        <path
          d="M64 132 C64 114 68 102 78 88 C92 68 109 56 120 48 C131 56 148 68 162 88 C172 102 176 114 176 132 Z"
          fill="var(--ph-dome)"
        />
        <circle cx="120" cy="49" r="3.6" fill="var(--ph-dome)" />
        <g fill="var(--ph-dome)">
          <rect x={compact ? '117.9' : '118.35'} y="14" width={compact ? '4.2' : '3.3'} height="34" />
          <rect x={compact ? '113.5' : '114.25'} y={compact ? '19.4' : '19.1'} width={compact ? '13' : '11.5'} height={compact ? '3.2' : '2.6'} />
          <rect x={compact ? '107.5' : '109'} y={compact ? '26.4' : '25.9'} width={compact ? '25' : '22'} height={compact ? '4.2' : '3.3'} />
          {!compact && <path d="M112.8 37 L127.2 41.4 L127.2 44.3 L112.8 39.9 Z" />}
        </g>
        {!compact && (
          <g fill="var(--ph-bg)">
            {[71, 93, 115, 137, 159].map((x) => (
              <path key={x} d={`M${x} 200v-45a5 5 0 0 1 10 0v45Z`} />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
