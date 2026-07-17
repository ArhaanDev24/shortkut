import { useId } from 'react'

/**
 * The ShortKut mark: a purple crayon-scribble ball.
 * Layered rough elliptical strokes + turbulence filters give the waxy crayon edge;
 * `label` writes "ShortKut" across the middle (legible at size >= ~96).
 */
export default function Logo({
  size = 24,
  label = false,
  animated = false
}: {
  size?: number
  label?: boolean
  /** Draw the scribble strokes in one by one on mount, then breathe gently. */
  animated?: boolean
}): React.JSX.Element {
  const uid = useId()
  const rough = `rough-${uid}`
  const grain = `grain-${uid}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="ShortKut"
      className={animated ? 'logo-animated' : undefined}
    >
      <defs>
        <filter id={rough} x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="7" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="7" />
        </filter>
        <filter id={grain} x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="noise" />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0.55"
            result="noiseAlpha"
          />
          <feComposite in="SourceGraphic" in2="noiseAlpha" operator="in" />
        </filter>
      </defs>

      <g filter={`url(#${grain})`}>
        <g filter={`url(#${rough})`} stroke="#7444c8" fill="none" strokeLinecap="round">
          <circle cx="60" cy="60" r="38" fill="#7444c8" stroke="none" opacity="0.92" />
          <ellipse cx="60" cy="60" rx="40" ry="36" strokeWidth="7" opacity="0.85" transform="rotate(18 60 60)" pathLength="100" />
          <ellipse cx="59" cy="61" rx="37" ry="41" strokeWidth="6.5" opacity="0.8" transform="rotate(-24 60 60)" pathLength="100" />
          <ellipse cx="61" cy="59" rx="42" ry="38" strokeWidth="6" opacity="0.65" transform="rotate(55 60 60)" pathLength="100" />
          <ellipse cx="60" cy="60" rx="30" ry="27" strokeWidth="8" opacity="0.8" transform="rotate(-40 60 60)" pathLength="100" />
          <ellipse cx="58" cy="61" rx="22" ry="25" strokeWidth="9" opacity="0.75" transform="rotate(30 60 60)" pathLength="100" />
          <ellipse cx="61" cy="58" rx="16" ry="13" strokeWidth="10" opacity="0.7" transform="rotate(-15 60 60)" pathLength="100" />
        </g>
      </g>

      {label && (
        <text
          x="60"
          y="65"
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          fontFamily="'Chalkboard SE', 'Comic Sans MS', 'Marker Felt', cursive"
          fill="#f6f2e9"
          letterSpacing="0.5"
        >
          ShortKut
        </text>
      )}
    </svg>
  )
}
