import Link from 'next/link';
import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.section}>
        {/* <hr className={styles.hr} /> Removed to avoid double lines */}
        <div className={styles.containerLg}>
          <div className={styles.row + ' ' + styles.pb3}>
            <div className={styles.col} style={{ display: 'flex', alignItems: 'center' }}>
              <img src="/img/aven.svg" width={71} height={27} alt="Logo" />
            </div>
          </div>
          <div className={styles.row + ' ' + styles.textMdStart}>
            <div className={styles.col6 + ' ' + styles.colMd3 + ' ' + styles.mb3}>
              <p className={styles.sectionHeader + ' ' + styles.fwBold + ' ' + styles.mb3}>Aven</p>
              <p className={styles.mb1}><Link href="/" className={styles.textMuted}>Card</Link></p>
              <p className={styles.mb1}><Link href="/education" className={styles.textMuted}>How It Works</Link></p>
              <p className={styles.mb1}><Link href="/testimonials" className={styles.textMuted}>Testimonials</Link></p>
              <p className={styles.mb1}><Link href="/app" className={styles.textMuted}>App</Link></p>
              <p className={styles.mb1}><Link href="/about" className={styles.textMuted}>About Us</Link></p>
              <p className={styles.mb1}><Link href="/careers" className={styles.textMuted}>Careers</Link></p>
            </div>
            <div className={styles.col6 + ' ' + styles.colMd3 + ' ' + styles.mb3}>
              <p className={styles.sectionHeader + ' ' + styles.fwBold}>Resources</p>
              <p className={styles.mb1}><Link href="/press" className={styles.textMuted}>Press</Link></p>
              <p className={styles.mb1}><Link href="/privacy" className={styles.textMuted}>Privacy</Link></p>
              <p className={styles.mb1}><a href="/docs/TermsOfUse.pdf" target="_blank" className={styles.textMuted}>Terms of Service</a></p>
              <p className={styles.mb1}><a href="/public/docs/PifTerms" target="_blank" className={styles.textMuted}>Pay It Forward</a></p>
              <p className={styles.mb1}><Link href="/licenses" className={styles.textMuted}>Licenses</Link></p>
              <p className={styles.mb1}><Link href="/disclosures" className={styles.textMuted}>Disclosures</Link></p>
            </div>
            <div className={styles.colMd + ' ' + styles.msAuto + ' ' + styles.dFlex + ' ' + styles.justifyContentMdEnd} style={{ justifyContent: 'center' }}>
              <img src="/img/aven.svg" width={71} height={27} alt="Logo" />
            </div>
          </div>
        </div>
        <div className={styles.footerSlot + ' ' + styles.mt3 + ' ' + styles.pt3 + ' ' + styles.pb3 + ' ' + styles.textMuted}>
          <div className={styles.container + ' ' + styles.textMdStart}>
            <p className={styles.small + ' ' + styles.textMuted}>© 2025 Aven Demo</p>
            <p className={styles.textXs}>This is a demo site. No real financial products or services are offered. All links and disclosures are for demonstration purposes only.</p>
            <p className={styles.textXs}><a href="mailto:support@aven.com" className={styles.textMuted + ' ' + styles.textUnderline}>support@aven.com</a></p>
          </div>
        </div>
      </div>
    </footer>
  );
} 