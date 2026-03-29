'use client';
interface Props { data: number[]; width?: number; height?: number; }
export function Sparkline({ data, width = 120, height = 24 }: Props) {
  if (data.length < 2) return <span style={{ display: 'inline-block', width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 0.001;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = data[data.length - 1];
  const first = data[0];
  const color = last > first ? '#22c55e' : last < first ? '#ef4444' : 'rgba(255,255,255,0.3)';
  return (
    <svg width={width} height={height} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
