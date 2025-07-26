'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from './Navbar.module.css';

export default function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isStickyVisible, setIsStickyVisible] = useState(false);

  // Handle scroll for sticky navigation
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      setIsStickyVisible(scrollTop > 100);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const handleDropdownMouseEnter = () => {
    setIsDropdownOpen(true);
  };

  const handleDropdownMouseLeave = () => {
    setIsDropdownOpen(false);
  };

  return (
    <div className={styles['component-navbar']}>
      <div className={`${styles['nav-container']} ${styles.container}`}>
        <nav className={`${styles.nav} ${styles['tw-bg-white']}`}>
          {/* Left section - Logo */}
          <div className={styles.left}>
            <div id="nav-logo">
              <Link href="/" className={styles.brand} aria-label="Aven">
                <svg width="71" height="27" viewBox="0 0 71 27" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.logo}>
                  <path d="M29.0482 16.7188L24.5517 5.10052H20.1105L26.9116 20.6214H31.336L37.8227 5.10052H33.3814L29.0482 16.7188Z" fill="black"></path>
                  <path d="M63.942 4.67607C61.0924 4.67607 58.3052 5.76079 56.8432 6.61205V20.6214H60.6939V8.7862C60.6939 8.7862 61.7982 8.10472 63.6971 8.10472C66.6764 8.10472 67.1517 10.2364 67.1517 12.5497V20.6214H71V11.4084C71 7.72742 68.873 4.67607 63.942 4.67607Z" fill="black"></path>
                  <path d="M25.3127 27H20.7586L16.255 16.4146H10.2149V12.9977H14.8026L11.3 4.76568L4.6165 20.6214H0L9.11777 0H13.4438L25.3127 27Z" fill="black"></path>
                  <path d="M46.2754 4.67607C41.6109 4.67607 38.3916 8.12594 38.3916 12.7761C38.3916 17.596 41.5509 21.152 46.7292 21.152C49.3195 21.152 51.6001 20.2488 53.2782 18.4378L50.6063 16.0538C49.7132 17.0513 48.1528 17.7469 46.6643 17.7469C44.4269 17.7469 42.2423 16.0774 42.2423 12.7761C42.2423 10.102 43.7811 8.10472 46.2706 8.10472C48.3304 8.10472 49.7348 9.29319 49.9701 11.1537H44.9527V14.2404H53.9024C53.9024 14.2404 54.0056 13.3137 54.0056 12.6747C54.0056 8.30987 51.3601 4.67607 46.2754 4.67607Z" fill="black"></path>
                </svg>
              </Link>
            </div>
          </div>

          {/* Middle section - Navigation links */}
          <div className={styles.middle}>
            <ul>
              <li>
                <Link href="/" className={styles['nav-item']}>
                  Card
                </Link>
              </li>
              <li>
                <Link href="/education" className={styles['nav-item']}>
                  How It Works
                </Link>
              </li>
              <li>
                <Link href="/reviews" className={styles['nav-item']}>
                  Reviews
                </Link>
              </li>
              <li>
                <Link href="/support" className={styles['nav-item']}>
                  Support
                </Link>
              </li>
              <li>
                <Link href="/app" className={styles['nav-item']}>
                  App
                </Link>
              </li>
              <li 
                className={styles['has-dropdown']}
                onMouseEnter={handleDropdownMouseEnter}
                onMouseLeave={handleDropdownMouseLeave}
              >
                <button 
                  className={`${styles['nav-item']} ${styles['dropdown-toggle']}`}
                  onClick={toggleDropdown}
                >
                  Who We Are
                </button>
                <div className={`${styles.dropdown} ${isDropdownOpen ? styles.show : ''}`}>
                  <Link href="/about" className={styles.dropdownLink}>
                    About Us
                  </Link>
                  <Link href="/contact" className={styles.dropdownLink}>
                    Contact Us
                  </Link>
                </div>
              </li>
            </ul>
          </div>

          {/* Right section - Sign In and mobile menu */}
          <div className={styles.right}>
            <div className={`${styles['component-hamburger']} ${styles['d-block']} ${styles['d-lg-none']}`}>
              <button 
                className={`${styles.hamburger} ${styles['navbar-toggler']} ${isMobileMenuOpen ? styles.active : ''}`}
                type="button" 
                onClick={toggleMobileMenu}
                aria-label="Toggle navigation"
              >
                <span className={styles['hamburger-box']}>
                  <span className={styles['hamburger-inner']}></span>
                </span>
              </button>
            </div>
            <ul className={`${styles['d-none']} ${styles['d-lg-block']}`}>
              <li>
                <a className={styles['nav-item']} href="https://my.aven.com">
                  Sign In
                </a>
              </li>
            </ul>
          </div>
        </nav>

        {/* Mobile navigation */}
        <div className={`${styles['mobile-nav']} ${isMobileMenuOpen ? styles.show : ''}`}>
          <ul>
            <li>
              <Link href="/" className={styles['nav-item']}>
                Card
              </Link>
            </li>
            <li>
              <Link href="/education" className={styles['nav-item']}>
                How It Works
              </Link>
            </li>
            <li>
              <Link href="/reviews" className={styles['nav-item']}>
                Reviews
              </Link>
            </li>
            <li>
              <Link href="/support" className={styles['nav-item']}>
                Support
              </Link>
            </li>
            <li>
              <Link href="/app" className={styles['nav-item']}>
                App
              </Link>
            </li>
            <li>
              <Link href="/about" className={styles['nav-item']}>
                About Us
              </Link>
            </li>
            <li>
              <Link href="/contact" className={styles['nav-item']}>
                Contact Us
              </Link>
            </li>
            <li>
              <a className={styles['nav-item']} href="https://my.aven.com">
                Sign In
              </a>
            </li>
          </ul>
        </div>
      </div>

      {/* Sticky navigation */}
      <nav className={`${styles.nav} ${styles.sticky} ${isStickyVisible ? styles.show : ''}`}>
        <div className={`${styles.container} ${styles['d-flex']}`}>
          <div className={styles.left}>
            <Link href="/" className={styles.brand}>
              <img src="/img/aven.svg" className={styles.logo} width="71" alt="Go Home" />
            </Link>
          </div>
          <div className={styles.right}>
            <button className={`${styles.btn} ${styles['nav-link']} ${styles['text-white']} ${styles['fw-bold']} ${styles['bg-dark']} ${styles['rounded-pill']} ${styles['ps-3']} ${styles['pe-3']} ${styles['ms-3']}`}>
              Check Offers
            </button>
          </div>
        </div>
      </nav>
    </div>
  );
} 