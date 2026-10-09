import { useState } from 'react';
import { initials } from '../lib/format';

/** Google profile photo, or two letters when there is none (or it fails to load). */
export function Avatar({ name, email, photoUrl, size = 36 }: { name: string; email: string; photoUrl?: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (photoUrl && !broken) {
    return (
      <img
        className="avatar"
        src={photoUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, var(--blue-600), var(--teal-500))', color: '#fff',
        fontWeight: 800, fontSize: Math.round(size * 0.38),
      }}
    >
      {initials(name, email)}
    </span>
  );
}
