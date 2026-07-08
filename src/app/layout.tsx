import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Православные маршруты',
  description: 'MVP сервиса взаимного подвоза к православным храмам',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
