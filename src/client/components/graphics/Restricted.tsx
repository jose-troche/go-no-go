export function Restricted({ label = "Outside your console's view", height }: { label?: string; height?: number }) {
  return (
    <div className="restricted" style={height ? { minHeight: height } : undefined} role="note">
      <span>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ display: "block", margin: "0 auto 6px" }}>
          <rect x="3.5" y="8" width="11" height="8" rx="1.5" fill="none" stroke="currentColor" />
          <path d="M6 8V5.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" />
        </svg>
        {label}
      </span>
    </div>
  );
}
