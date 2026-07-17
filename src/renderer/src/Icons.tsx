/**
 * ShortKut's icon set: simple stroke icons with round caps so they sit
 * naturally in the crayon theme. All inherit `currentColor`.
 */

interface IconProps {
  size?: number
}

function Svg({ size = 15, children }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

export function IconFolder(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M3 7c0-1.1.9-2 2-2h4l2 2.5h8c1.1 0 2 .9 2 2V17c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7Z" />
    </Svg>
  )
}

export function IconFolderPlus(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M3 7c0-1.1.9-2 2-2h4l2 2.5h8c1.1 0 2 .9 2 2V17c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7Z" />
      <path d="M12 10.5v5M9.5 13h5" />
    </Svg>
  )
}

export function IconFile(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 12.5h5M9.5 16h5" />
    </Svg>
  )
}

export function IconPencil(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1Z" />
      <path d="M13.5 6.5l3 3" />
    </Svg>
  )
}

export function IconMove(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M5 12h13" />
      <path d="M13 6l6 6-6 6" />
    </Svg>
  )
}

export function IconTrash(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 13h9l1-13" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </Svg>
  )
}

export function IconTerminal(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M7 9.5l3.5 3L7 15.5" />
      <path d="M12.5 15.5H17" />
    </Svg>
  )
}

export function IconLaunch(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M14 5h5v5" />
      <path d="M19 5l-8.5 8.5" />
      <path d="M19 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4.5" />
    </Svg>
  )
}

export function IconAutomation(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M9 20.5h6" />
      <path d="M12 16.5v4" />
      <path d="M9 8l3 2.5L9 13" />
    </Svg>
  )
}

export function IconGear(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 4.5v2.2M12 17.3v2.2M4.5 12h2.2M17.3 12h2.2M6.6 6.6l1.6 1.6M15.8 15.8l1.6 1.6M17.4 6.6l-1.6 1.6M8.2 15.8l-1.6 1.6" />
    </Svg>
  )
}

export function IconPlus(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function IconX(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

export function IconCheck(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M4.5 12.5l5 5L19.5 6.5" />
    </Svg>
  )
}

export function IconSend(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M3.5 11.5L20.5 4l-6.5 16.5-2.8-7.2-7.7-1.8Z" />
      <path d="M11.2 13.3L20.5 4" />
    </Svg>
  )
}

export function IconCopy(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </Svg>
  )
}

export function IconUser(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1-4 4.5-5.5 7-5.5s6 1.5 7 5.5" />
    </Svg>
  )
}

export function IconClock(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  )
}

export function IconEye(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

export function IconCursor(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M5 3l6.5 16 2.2-6.3L20 10.5 5 3Z" />
    </Svg>
  )
}

export function IconBolt(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M13 2L5 13.5h5L9.5 22 18 10.5h-5.5L13 2Z" />
    </Svg>
  )
}

export function IconMoon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </Svg>
  )
}

export function IconSun(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </Svg>
  )
}

export function IconStop(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />
    </Svg>
  )
}
