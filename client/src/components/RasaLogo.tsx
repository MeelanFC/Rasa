/**
 * Rasa mark: a droplet holding a play button. "Rasa" (रस) is Sanskrit for
 * juice/essence - the flavor a work of art leaves in you. The drop is the
 * essence; the play triangle is what you do with it.
 */
export function RasaLogo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Rasa logo"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="rasa-drop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="55%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      <path
        d="M32 4 C32 4 10 27 10 40 a22 22 0 0 0 44 0 C54 27 32 4 32 4 Z"
        fill="url(#rasa-drop)"
      />
      <path
        d="M32 4 C32 4 10 27 10 40 a22 22 0 0 0 44 0 C54 27 32 4 32 4 Z"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.14"
        strokeWidth="2"
      />
      <path
        d="M27.5 32.5 L27.5 47.5 L41 40 Z"
        fill="#ffffff"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
