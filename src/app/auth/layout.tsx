import localFont from 'next/font/local';
import styles from './auth.module.css';

const onest = localFont({
  src: '../design-preview/fonts/Onest-Variable.ttf',
  display: 'swap',
  style: 'normal',
  weight: '400 600',
  variable: '--font-onest',
});

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={`${onest.variable} ${styles.authRoot}`}>{children}</div>;
}
