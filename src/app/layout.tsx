import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Православные маршруты',
  description: 'Сервис взаимного подвоза православных людей к храмам',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
