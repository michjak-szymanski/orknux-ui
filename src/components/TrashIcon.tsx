/**
 * The design draws the bin from five rectangles rather than referencing an icon
 * component, so those exact shapes are transcribed here (32x32 button box).
 */
export function TrashIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="9" y="8" width="14" height="1.5" rx="0.5" fill="currentColor" />
      <rect x="13" y="6.5" width="6" height="1.5" rx="0.5" fill="currentColor" />
      <rect
        x="11.75"
        y="11.25"
        width="8.5"
        height="10.5"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="14" y="13" width="1.2" height="6" rx="1" fill="currentColor" />
      <rect x="17" y="13" width="1.2" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}
