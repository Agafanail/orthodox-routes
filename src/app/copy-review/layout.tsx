import localFont from 'next/font/local';

/**
 * The canonical Design System V2 typeface. The file is shared with the approved reference artifact
 * instead of being duplicated: this route reads it, it never modifies it.
 */
const onest = localFont({
  src: '../design-preview/fonts/Onest-Variable.ttf',
  display: 'swap',
  style: 'normal',
  weight: '400 600',
  variable: '--font-onest',
});

export default function CopyReviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={onest.variable}>{children}</div>;
}
