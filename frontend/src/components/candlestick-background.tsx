import type { ReactNode } from "react"

/** Stable coords so SSR/hydration stay consistent. */
function svgCoord(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

/**
 * Subtle candlestick watermark (same idea as mt5-dashboard Analytics Engine).
 * Deterministic — no Math.random.
 */
export function CandlestickBackground() {
  const candles: ReactNode[] = []

  const rows = [
    {
      count: 60,
      spacing: 50,
      startX: 30,
      baseY: 150,
      waveFunc: (i: number) => Math.sin(i * 0.25) * 45,
    },
    {
      count: 55,
      spacing: 55,
      startX: 60,
      baseY: 350,
      waveFunc: (i: number) => Math.cos(i * 0.3) * 40,
    },
    {
      count: 65,
      spacing: 45,
      startX: 20,
      baseY: 550,
      waveFunc: (i: number) => Math.sin(i * 0.2) * 50,
    },
    {
      count: 58,
      spacing: 52,
      startX: 80,
      baseY: 750,
      waveFunc: (i: number) => Math.cos(i * 0.28) * 38,
    },
  ]

  rows.forEach((row, rowIndex) => {
    for (let i = 0; i < row.count; i++) {
      const x = row.startX + i * row.spacing
      const trend = row.waveFunc(i)
      const volatility = Math.sin(rowIndex * 100 + i * 7.3) * 0.5 * 18
      const currentPrice = row.baseY + trend + volatility
      const prevPrice = i > 0 ? row.baseY + row.waveFunc(i - 1) : row.baseY
      const isBull = currentPrice < prevPrice
      const bodyHeight =
        12 + Math.abs(trend) * 0.25 + Math.abs(Math.sin(i * 3.7)) * 8
      const upperWick = 6 + Math.abs(Math.sin(i * 2.1)) * 10
      const lowerWick = 6 + Math.abs(Math.cos(i * 1.9)) * 10
      const bodyTop = currentPrice
      const bodyBottom = currentPrice + bodyHeight
      const color = isBull ? "#26a69a" : "#ef5350"

      candles.push(
        <g
          key={`row${rowIndex}-${i}`}
          opacity="0.05"
          className="dark:opacity-[0.04]"
        >
          <line
            x1={svgCoord(x)}
            y1={svgCoord(bodyTop - upperWick)}
            x2={svgCoord(x)}
            y2={svgCoord(bodyTop)}
            stroke={color}
            strokeWidth="1.5"
          />
          <line
            x1={svgCoord(x)}
            y1={svgCoord(bodyBottom)}
            x2={svgCoord(x)}
            y2={svgCoord(bodyBottom + lowerWick)}
            stroke={color}
            strokeWidth="1.5"
          />
          <rect
            x={svgCoord(x - 7)}
            y={svgCoord(bodyTop)}
            width="14"
            height={svgCoord(bodyHeight)}
            fill={color}
          />
        </g>,
      )
    }
  })

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 2000 1000"
    >
      {candles}
    </svg>
  )
}
