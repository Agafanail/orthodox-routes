import localFont from 'next/font/local';

const onest = localFont({
  src: './fonts/Onest-Variable.ttf',
  display: 'swap',
  style: 'normal',
  weight: '400 600',
  variable: '--font-onest',
});

export default function DesignPreviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={onest.variable}>{children}</div>;
}
