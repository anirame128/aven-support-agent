'use client'
import styles from './DemoBanner.module.css';
import { useState } from 'react';

export default function DemoBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className={styles.banner}>
      <span>
        <strong>Demo Website:</strong> This site is for demonstration purposes only and is not affiliated with aven.com or Aven Financial, Inc.
      </span>
      <button
        className={styles.close}
        onClick={() => setVisible(false)}
        aria-label="Dismiss banner"
        type="button"
      >
        ×
      </button>
    </div>
  );
} 